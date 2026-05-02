import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

export interface PayoutRequest {
  provider: string;
  amount: number;
  currency: string;
  recipientAccount: string;
  recipientName: string;
  recipientPhone?: string;
  recipientBankCode?: string;
  recipientBankName?: string;
  purpose?: string;
  reference: string;
  metadata?: Record<string, unknown>;
}

export interface PayoutResponse {
  success: boolean;
  transactionId?: string;
  providerTransactionId?: string;
  status: 'pending' | 'completed' | 'failed' | 'initiated';
  message: string;
  rawResponse?: unknown;
}

export interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  authType: 'oauth2' | 'apikey' | 'hmac' | 'basic' | 'otp_token' | 'jwt_basic' | 'pkcs7_xml' | 'jwe_oauth2' | 'aes_token' | 'soap_salted' | 'dll_session';
  credentials: Record<string, string>;
  supportedCorridors: string[];
  supportedCurrencies: string[];
  payoutMethods: string[];
  rateLimitPerMin: number;
}

@Injectable()
export abstract class PayoutProvider {
  protected readonly logger = new Logger(this.constructor.name);
  protected abstract readonly providerCode: string;
  
  constructor(protected readonly cfg: ConfigService) {}
  
  abstract initialize(config: ProviderConfig): Promise<void>;
  abstract sendPayout(request: PayoutRequest): Promise<PayoutResponse>;
  abstract checkStatus(providerTransactionId: string): Promise<PayoutResponse>;
  abstract validateCredentials(): Promise<boolean>;

  async getBalance(): Promise<number> {
    throw new Error('getBalance not implemented for this provider');
  }
}

// ============================================
// PAYMOB PROVIDER (Egypt - OAuth2)
// ============================================
@Injectable()
export class PaymobProvider extends PayoutProvider {
  protected readonly providerCode = 'paymob';
  private api!: AxiosInstance;
  private config!: ProviderConfig;
  private accessToken!: string;
  private tokenExpiry!: Date;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
    
    this.api.interceptors.request.use(async (cfg) => {
      if (!this.accessToken || new Date() > this.tokenExpiry) {
        await this.refreshToken();
      }
      cfg.headers['Authorization'] = `Bearer ${this.accessToken}`;
      return cfg;
    });
  }

  private async refreshToken(): Promise<void> {
    const { clientId, clientSecret } = this.config.credentials;
    const res = await axios.post(`${this.config.baseUrl}/oauth/token`, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    });
    this.accessToken = res.data.access_token;
    this.tokenExpiry = new Date(Date.now() + res.data.expires_in * 1000);
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const res = await this.api.post('/disbursement', {
        issuer: request.metadata?.issuer || 'bank_wallet',
        amount: request.amount,
        msisdn: request.recipientAccount,
        currency: request.currency,
        reference: request.reference,
      });

      return {
        success: res.data.status === 'success',
        providerTransactionId: res.data.transaction_id,
        status: 'initiated',
        message: res.data.message || 'Payout initiated',
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`Paymob payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const res = await this.api.get(`/disbursement/${providerTransactionId}`);
      return {
        success: true,
        providerTransactionId,
        status: res.data.status === 'success' ? 'completed' : 'pending',
        message: res.data.status,
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.refreshToken();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// SAMSARA REMIT PROVIDER (Malaysia - HMAC)
// ============================================
@Injectable()
export class SamsaraProvider extends PayoutProvider {
  protected readonly providerCode = 'samsara';
  private api!: AxiosInstance;
  private config!: ProviderConfig;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private generateHmac(payload: string): string {
    const hmac = crypto.createHmac('sha256', this.config.credentials.appSecret);
    hmac.update(payload);
    return hmac.digest('hex');
  }

  private async callApi(endpoint: string, data: unknown): Promise<any> {
    const payload = JSON.stringify(data);
    const signature = this.generateHmac(payload);
    const nonce = Math.random().toString(36).substring(7);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    const res = await this.api.post(endpoint, data, {
      headers: {
        'Authorization': `hmacauth ${this.config.credentials.appId}:${signature}:${nonce}:${timestamp}`,
      },
    });
    return res.data;
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const exRate = await this.callApi('/GetEXRate', {
        agentSessionId: request.reference,
        transferAmount: request.amount,
        calcBy: 'P',
        payoutCurrency: request.currency,
        paymentMode: request.metadata?.paymentMode || 'C',
        locationId: request.metadata?.locationId,
        payoutCountry: request.metadata?.payoutCountry,
      });

      const tx = await this.callApi('/SendTransaction', {
        agentSessionId: request.reference,
        agentTxnId: request.reference,
        locationId: request.metadata?.locationId,
        transferAmount: request.amount,
        payoutAmount: exRate.payoutAmount,
        payoutCurrency: request.currency,
        paymentMode: request.metadata?.paymentMode || 'C',
        RemitterType: 'I',
        senderFirstName: request.metadata?.senderFirstName,
        senderLastName: request.metadata?.senderLastName,
        senderGender: request.metadata?.senderGender,
        beneficiaryName: request.recipientName,
        beneficiaryPhone: request.recipientPhone,
        beneficiaryAccount: request.recipientAccount,
      });

      return {
        success: tx.code === '0',
        providerTransactionId: tx.transactionId,
        status: tx.code === '0' ? 'initiated' : 'failed',
        message: tx.message,
        rawResponse: tx,
      };
    } catch (err) {
      this.logger.error(`Samsara payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const res = await this.callApi('/GetTransactionStatus', {
        agentSessionId: providerTransactionId,
        agentTxnId: providerTransactionId,
      });

      return {
        success: res.code === '0',
        providerTransactionId,
        status: res.transactionStatus === 'COMPLETED' ? 'completed' : 'pending',
        message: res.message,
        rawResponse: res,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      const res = await this.callApi('/GetEcho', { agentSessionId: 'test' });
      return res.code === '0';
    } catch {
      return false;
    }
  }
}

// ============================================
// KHALTI PROVIDER (Nepal - API Key)
// ============================================
@Injectable()
export class KhaltiProvider extends PayoutProvider {
  protected readonly providerCode = 'khalti';
  private api!: AxiosInstance;
  private config!: ProviderConfig;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Authorization': `Key ${config.credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const res = await this.api.post('/fund/load/', {
        user: request.recipientAccount,
        amount: Math.round(request.amount * 100),
        remarks: request.purpose || 'Wallet load via API',
        reference: request.reference,
      });

      return {
        success: res.data.state === 'PENDING' || res.data.state === 'COMPLETED',
        providerTransactionId: res.data.reference,
        status: res.data.state === 'COMPLETED' ? 'completed' : 'initiated',
        message: res.data.detail || 'Payout initiated',
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`Khalti payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const res = await this.api.get('/fund/loadstatus/', {
        params: { reference: providerTransactionId, amount: 0 },
      });

      return {
        success: true,
        providerTransactionId,
        status: res.data.state === 'COMPLETED' ? 'completed' : 'pending',
        message: res.data.detail,
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.api.get('/fund/loadstatus/?reference=test&amount=0');
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// SAFEPAY RAAST PROVIDER (Pakistan - API Key)
// ============================================
@Injectable()
export class SafepayRaastProvider extends PayoutProvider {
  protected readonly providerCode = 'safepay_raast';
  private api!: AxiosInstance;
  private config!: ProviderConfig;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'X-SFPY-AGGREGATOR-SECRET-KEY': config.credentials.secretKey,
        'Content-Type': 'application/json',
      },
    });
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const res = await this.api.post(`/v1/aggregators/${this.config.credentials.aggregatorId}/payout`, {
        request_id: request.reference,
        amount: request.amount.toFixed(2),
        creditor_iban: request.recipientAccount,
        creditor_name: request.recipientName,
        purpose: request.purpose || 'Home Remittance',
      });

      return {
        success: res.data.data?.status === 'P_INITIATED',
        providerTransactionId: res.data.data?.token,
        status: 'initiated',
        message: res.data.data?.status || 'Payout initiated',
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`Safepay payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const res = await this.api.get(`/v1/aggregators/${this.config.credentials.aggregatorId}/payments`, {
        params: { payout_token: providerTransactionId },
      });

      return {
        success: true,
        providerTransactionId,
        status: res.data.data?.status === 'SETTLED' ? 'completed' : 'pending',
        message: res.data.data?.status,
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      const res = await this.api.get(`/v1/aggregators/${this.config.credentials.aggregatorId}`);
      return res.data?.data?.is_active === true;
    } catch {
      return false;
    }
  }
}

// ============================================
// 8B PROVIDER (Uzbekistan/Kazakhstan - HMAC)
// ============================================
@Injectable()
export class EightBProvider extends PayoutProvider {
  protected readonly providerCode = '8b';
  private api!: AxiosInstance;
  private config!: ProviderConfig;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private generateSignature(data: Record<string, unknown>): string {
    const sortedKeys = Object.keys(data).sort();
    const stringToSign = sortedKeys.map(k => `${k}=${data[k]}`).join('&');
    return crypto.createHmac('sha256', this.config.credentials.secretKey)
      .update(stringToSign)
      .digest('hex');
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const payload = {
        service_id: this.config.credentials.serviceId,
        order_id: request.reference,
        amount: request.amount.toString(),
        currency: request.currency,
        card_number: request.recipientAccount,
        description: request.purpose || 'Payout via FELO',
      };
      const signature = this.generateSignature(payload);

      const res = await this.api.post('/api/payout', { ...payload, signature });

      return {
        success: res.data.state === 'PAID' || res.data.state === 'PENDING',
        providerTransactionId: res.data.transaction_id,
        status: res.data.state === 'PAID' ? 'completed' : 'initiated',
        message: res.data.state,
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`8B payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const payload = {
        service_id: this.config.credentials.serviceId,
        transaction_id: providerTransactionId,
      };
      const signature = this.generateSignature(payload);
      const res = await this.api.post('/api/status', { ...payload, signature });

      return {
        success: true,
        providerTransactionId,
        status: res.data.state === 'PAID' ? 'completed' : 'pending',
        message: res.data.state,
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.api.get('/api/ping');
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// HRC UBL PROVIDER (Pakistan - OAuth + SOAP)
// ============================================
@Injectable()
export class HrcUblProvider extends PayoutProvider {
  protected readonly providerCode = 'hrc_ubl';
  private api!: AxiosInstance;
  private config!: ProviderConfig;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 180000, // 180 seconds as per spec
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  private async getAuthToken(): Promise<string> {
    const { custLoginId, custPassword, authenCode } = this.config.credentials;
    const res = await this.api.post('/oauth/oauth2/token', {
      CustLoginId: custLoginId,
      CustPassword: custPassword,
      Authen_Code: authenCode,
    });
    return res.data.access_token;
  }

  private buildSoapEnvelope(service: string, body: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ubl="http://localhost/UBL_HRC_API/">
  <soapenv:Header/>
  <soapenv:Body>
    <ubl:${service}>
      ${body}
    </ubl:${service}>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const token = await this.getAuthToken();
      const isUblToUbl = request.recipientBankCode === '24' || !request.recipientBankCode;
      
      const soapBody = `
        <CustLoginId>${this.config.credentials.custLoginId}</CustLoginId>
        <CustPassword>${this.config.credentials.custPassword}</CustPassword>
        <Authen_Code>${this.config.credentials.authenCode}</Authen_Code>
        <TrnRefNo>${request.reference}</TrnRefNo>
        <REMITTANCETYPE>${isUblToUbl ? 'D' : 'C-'}</REMITTANCETYPE>
        <ISIBFT>${isUblToUbl ? '0' : '1'}</ISIBFT>
        <SENDERNAME>${request.metadata?.senderName || request.recipientName}</SENDERNAME>
        <REMITTANCEDATE>${new Date().toISOString()}</REMITTANCEDATE>
        <EXCHANGERATE>${request.metadata?.exchangeRate || '1.0'}</EXCHANGERATE>
        <REMITTANCEAMOUNT>${request.amount}</REMITTANCEAMOUNT>
        <LOCALAMOUNT>${request.amount}</LOCALAMOUNT>
        <BENEFICIARYNAME>${request.recipientName}</BENEFICIARYNAME>
        <ACCOUNTNO>${request.recipientAccount}</ACCOUNTNO>
        <BANKCODE>${request.recipientBankCode || '24'}</BANKCODE>
        <BRANCHCODE>${request.metadata?.branchCode || ''}</BRANCHCODE>
        <PURPOSEOFREMITTANCE>${request.purpose || 'Home Remittance'}</PURPOSEOFREMITTANCE>
      `;

      const res = await this.api.post('/UBL_HRC_API_FundTransfer', 
        this.buildSoapEnvelope('Opr_FundTransfer', soapBody),
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/xml' } }
      );

      // Parse SOAP response (simplified)
      const statusCode = this.extractXmlValue(res.data, 'StatusCode');
      const statusDesc = this.extractXmlValue(res.data, 'StatusDesc');
      const transactionId = this.extractXmlValue(res.data, 'TransactionId');

      return {
        success: statusCode === '100',
        providerTransactionId: transactionId,
        status: statusCode === '100' ? 'initiated' : 'failed',
        message: statusDesc,
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`HRC UBL payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const token = await this.getAuthToken();
      const soapBody = `
        <CustLoginId>${this.config.credentials.custLoginId}</CustLoginId>
        <CustPassword>${this.config.credentials.custPassword}</CustPassword>
        <Authen_Code>${this.config.credentials.authenCode}</Authen_Code>
        <TrnRefNo>${providerTransactionId}</TrnRefNo>
      `;

      const res = await this.api.post('/UBL_HRC_API_GetStatus',
        this.buildSoapEnvelope('Opr_GetStatus', soapBody),
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/xml' } }
      );

      const statusCode = this.extractXmlValue(res.data, 'StatusCode');
      const statusDesc = this.extractXmlValue(res.data, 'StatusDesc');
      const transactionStatus = this.extractXmlValue(res.data, 'TransactionStatus');

      return {
        success: statusCode === '100',
        providerTransactionId,
        status: transactionStatus === 'SUCCESS' ? 'completed' : 'pending',
        message: statusDesc,
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  private extractXmlValue(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
    return match ? match[1] : '';
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getAuthToken();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// HABIB METRO PROVIDER (Pakistan - OTP Token)
// ============================================
@Injectable()
export class HabibMetroProvider extends PayoutProvider {
  protected readonly providerCode = 'habib_metro';
  private api!: AxiosInstance;
  private config!: ProviderConfig;
  private authToken!: string;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async getAuthToken(): Promise<string> {
    if (this.authToken) return this.authToken;
    
    // In production, OTP would be generated and sent to agent
    // For API integration, we use a stored/long-lived token approach
    // or the ops portal manages OTP verification
    const { companyId, agentId, preVerifiedToken } = this.config.credentials;
    
    if (preVerifiedToken) {
      this.authToken = preVerifiedToken;
      return this.authToken;
    }
    
    // Fallback: generate + verify OTP (for testing)
    const otpRes = await this.api.post('/Generateotp/', { companyId, agentId });
    const verifyRes = await this.api.post('/verifyotp/', { 
      companyId, 
      agentId, 
      otp: otpRes.data.otp 
    });
    
    this.authToken = verifyRes.data.token;
    return this.authToken;
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const token = await this.getAuthToken();
      const isDirect = request.metadata?.direct === true;
      const endpoint = isDirect ? '/Coc/fin-transaction' : '/Coc/transaction';
      
      const res = await this.api.post(endpoint, {
        companyId: this.config.credentials.companyId,
        remittercompanyName: this.config.credentials.companyName,
        transactionCode: request.reference,
        remitteridnoType: request.metadata?.remitterIdType || 'Passport',
        remitterId: request.metadata?.remitterId,
        remitterName: request.metadata?.remitterName,
        remittancecurrencyCode: request.currency,
        amountPkr: request.amount,
        remittPurpose: 'Home Remittance',
        senderCountry: request.metadata?.senderCountry || 'AE',
        benName: request.recipientName,
        bankAccountnumber: request.recipientAccount || '',
        beneBankcode: request.recipientBankCode,
        beneBankname: request.recipientBankName,
        remittingAmount: request.metadata?.remittingAmount,
        amountinWord: request.metadata?.amountInWords,
      }, {
        headers: { Authentication: token },
      });

      return {
        success: res.data.responseCode === 0,
        providerTransactionId: res.data.requestNumber?.toString(),
        status: res.data.responseCode === 0 ? 'initiated' : 'failed',
        message: res.data.responseCodeDesc,
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`HabibMetro payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const token = await this.getAuthToken();
      const res = await this.api.post('/Coc/cocstatus/', {
        companyId: this.config.credentials.companyId,
        requestNumber: providerTransactionId,
      }, {
        headers: { Authentication: token },
      });

      return {
        success: res.data.responseCode === 0,
        providerTransactionId,
        status: res.data.status === 'PAID' ? 'completed' : 'pending',
        message: res.data.statusDesc,
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getAuthToken();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// DIGIT9 PROVIDER (Pakistan - OAuth2 Password Grant)
// ============================================
@Injectable()
export class Digit9Provider extends PayoutProvider {
  protected readonly providerCode = 'digit9';
  private api!: AxiosInstance;
  private config!: ProviderConfig;
  private accessToken!: string;
  private tokenExpiry!: Date;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'sender': config.credentials.sender || 'commerceplexltd',
        'channel': config.credentials.channel || 'Direct',
        'company': config.credentials.company || '',
        'branch': config.credentials.branch || '',
      },
    });

    this.api.interceptors.request.use(async (cfg) => {
      if (!this.accessToken || new Date() > this.tokenExpiry) {
        await this.refreshToken();
      }
      cfg.headers['Authorization'] = `Bearer ${this.accessToken}`;
      return cfg;
    });
  }

  private async refreshToken(): Promise<void> {
    const { username, password, clientId, clientSecret } = this.config.credentials;
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);
    params.append('grant_type', 'password');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);

    const res = await axios.post(
      `${this.config.baseUrl}/auth/realms/cdp/protocol/openid-connect/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    this.accessToken = res.data.access_token;
    this.tokenExpiry = new Date(Date.now() + res.data.expires_in * 1000);
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const quoteRes = await this.api.post('/amr/paas/api/v1_0/paas/quote', {
        sending_country_code: request.metadata?.sendingCountryCode || 'AE',
        sending_currency_code: request.metadata?.sendingCurrencyCode || 'USD',
        service_type: 'C2C',
        receiving_country_code: request.metadata?.receivingCountryCode || 'PK',
        receiving_currency_code: request.currency,
        sending_amount: request.amount,
        receiving_mode: request.metadata?.receivingMode || 'BANK',
        type: 'SEND',
        instrument: 'REMITTANCE',
      });

      const quoteId = quoteRes.data.data?.quote_id;

      const txRes = await this.api.post('/amr/paas/api/v1_0/paas/createtransaction', {
        type: 'SEND',
        source_of_income: request.metadata?.sourceOfIncome || 'SLRY',
        purpose_of_txn: request.metadata?.purposeOfTxn || 'SAVG',
        instrument: 'REMITTANCE',
        quote_id: quoteId,
        sender: {
          agent_customer_number: request.metadata?.customerNumber || request.reference,
          mobile_number: request.metadata?.senderPhone || '+971500000000',
          first_name: request.metadata?.senderFirstName || 'Sender',
          last_name: request.metadata?.senderLastName || 'Name',
          date_of_birth: request.metadata?.senderDob || '1990-01-01',
          country_of_birth: request.metadata?.senderCountryOfBirth || 'IN',
          nationality: request.metadata?.senderNationality || 'IN',
        },
        receiver: {
          first_name: request.recipientName.split(' ')[0],
          last_name: request.recipientName.split(' ').slice(1).join(' ') || '',
          mobile_number: request.recipientPhone || '',
          account_number: request.recipientAccount,
        },
        message: request.purpose || 'Agency transaction',
      });

      return {
        success: txRes.data.status === 'success',
        providerTransactionId: txRes.data.data?.transaction_id || quoteId,
        status: txRes.data.status === 'success' ? 'initiated' : 'failed',
        message: txRes.data.status === 'success' ? 'Transaction created' : txRes.data.message,
        rawResponse: txRes.data,
      };
    } catch (err) {
      this.logger.error(`Digit9 payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      return {
        success: true,
        providerTransactionId,
        status: 'pending',
        message: 'Status check not available via API',
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.refreshToken();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// MTB PROVIDER (Bangladesh - JWT + AES Encryption)
// ============================================
@Injectable()
export class MtbProvider extends PayoutProvider {
  protected readonly providerCode = 'mtb';
  private api!: AxiosInstance;
  private config!: ProviderConfig;
  private jwtToken!: string;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async getJwtToken(): Promise<string> {
    if (this.jwtToken) return this.jwtToken;

    const { basicAuthUsername, basicAuthPassword, remitChannelId } = this.config.credentials;
    const res = await axios.post(
      `${this.config.baseUrl}/token/accessToken`,
      { remitChannelId },
      {
        auth: {
          username: basicAuthUsername,
          password: basicAuthPassword,
        },
      }
    );
    this.jwtToken = res.data.responseDetails?.accessToken;
    return this.jwtToken;
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const token = await this.getJwtToken();
      const reqId = request.reference;

      const payload = {
        reqId,
        referenceNumber: request.reference,
        tranMode: request.metadata?.tranMode || 'OTHERBANK',
        paymentInfo: {
          remitType: request.metadata?.remitType || 'WE01',
          tranAmount: request.amount.toFixed(2),
          originatingCurrency: request.metadata?.originatingCurrency || 'USD',
          forexRate: request.metadata?.forexRate || '1.0',
          originatingAmount: request.metadata?.originatingAmount || request.amount.toString(),
          sourceOfFund: request.metadata?.sourceOfFund || 'Salary',
          purposeOfFund: request.metadata?.purposeOfFund || 'Education',
        },
        senderInfo: {
          senderName: request.metadata?.senderName || 'Sender',
          senderPhone: request.metadata?.senderPhone || '+0000000000',
          senderGender: request.metadata?.senderGender || 'M',
          senderOccupation: request.metadata?.senderOccupation || 'Service',
          senderNationality: request.metadata?.senderNationality || 'BD',
          senderAddressDtls: {
            sendingCountry: request.metadata?.senderCountry || 'AE',
            senderAddress: request.metadata?.senderAddress || '',
          },
        },
        beneficiaryInfo: {
          beneficiaryName: request.recipientName,
          beneficiaryPhone: request.recipientPhone || '+8800000000000',
          beneficiaryGender: 'M',
          beneficiaryOccupation: 'Service',
          beneficiaryAddress: request.metadata?.beneficiaryAddress || 'Bangladesh',
          beneRelationship: request.metadata?.relationship || 'Others',
        },
        otherBank: request.metadata?.tranMode === 'OTHERBANK' ? {
          tranChannel: request.metadata?.tranChannel || 'BEFTN',
          beneficiaryAccount: request.recipientAccount,
          bankName: request.recipientBankName || '',
          branchName: request.metadata?.branchName || '',
        } : undefined,
        mtbAccount: request.metadata?.tranMode === 'MTB' ? {
          beneficiaryAccount: request.recipientAccount,
        } : undefined,
        walletAccount: request.metadata?.tranMode === 'WALLET' ? {
          walletNo: request.recipientAccount,
          walletName: request.metadata?.walletName || '',
        } : undefined,
      };

      const res = await this.api.post('/Payment/PaymentRequest', payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return {
        success: res.data.respCode === 'RS0000',
        providerTransactionId: res.data.transactionId || reqId,
        status: res.data.respCode === 'RS0000' ? 'initiated' : 'failed',
        message: res.data.respDesc,
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`MTB payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const token = await this.getJwtToken();
      const res = await this.api.post('/Payment/PaymentInquiry', {
        reqId: providerTransactionId,
        referenceNumber: providerTransactionId,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return {
        success: res.data.respCode === 'RS0000',
        providerTransactionId,
        status: res.data.transactionStatus === 'COMPLETED' ? 'completed' : 'pending',
        message: res.data.respDesc,
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getJwtToken();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// AGRANI BANK PROVIDER (Bangladesh - XML + Header Auth)
// ============================================
@Injectable()
export class AgraniBankProvider extends PayoutProvider {
  protected readonly providerCode = 'agrani_bank';
  private api!: AxiosInstance;
  private config!: ProviderConfig;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/xml',
        'Username': config.credentials.username,
        'Expassword': config.credentials.expassword,
      },
    });
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const { excode } = this.config.credentials;
      const trmode = request.metadata?.trmode || '15';

      const xmlPayload = `
<Transaction>
  <Header>
    <excode>${excode}</excode>
    <entereddatetime>${new Date().toISOString()}</entereddatetime>
  </Header>
  <tranno>${request.reference}</tranno>
  <traninfosl>${request.metadata?.traninfosl || '0'}</traninfosl>
  <trmode>${trmode}</trmode>
  <purpose>${request.metadata?.purpose || '2'}</purpose>
  <remamountsource>${request.metadata?.remamountsource || '0.0'}</remamountsource>
  <remamountdest>${request.amount}</remamountdest>
  <incentiveamount>0.0</incentiveamount>
  <incentiveamountagr>0.0</incentiveamountagr>
  <ratevalue>${request.metadata?.ratevalue || '1.00'}</ratevalue>
  <remid>0</remid>
  <scurr>${request.metadata?.scurr || 'USD'}</scurr>
  <remfname>${request.metadata?.remfname || 'Sender'}</remfname>
  <remlname>${request.metadata?.remlname || ''}</remlname>
  <remaddress1>${request.metadata?.remaddress1 || ''}</remaddress1>
  <remcountry>${request.metadata?.remcountry || 'AE'}</remcountry>
  <beneid>0</beneid>
  <benename>${request.recipientName.split(' ')[0]}</benename>
  <benemname>${request.recipientName.split(' ')[1] || ''}</benemname>
  <benelname>${request.recipientName.split(' ').slice(2).join(' ') || ''}</benelname>
  <beneaccountno>${request.recipientAccount}</beneaccountno>
  <benetel>${request.recipientPhone || ''}</benetel>
  <branchcode>${request.recipientBankCode || ''}</branchcode>
  <benebeftncode>${request.metadata?.benebeftncode || ''}</benebeftncode>
  <beneaddress>${request.metadata?.beneaddress || 'Bangladesh'}</beneaddress>
  <benecountry>BD</benecountry>
  <signaturevalue>${request.metadata?.signaturevalue || ''}</signaturevalue>
  <counttr>0</counttr>
  <transtatus>2</transtatus>
</Transaction>`;

      const res = await this.api.post('/AlRajhi', xmlPayload, {
        headers: {
          'username': this.config.credentials.username,
          'password': this.config.credentials.expassword,
        },
      });

      const responseCode = this.extractXmlValue(res.data, 'ResponseCode');
      const responseDesc = this.extractXmlValue(res.data, 'Responsedescription');

      return {
        success: responseCode === '200',
        providerTransactionId: request.reference,
        status: responseCode === '200' ? 'initiated' : 'failed',
        message: responseDesc,
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`Agrani Bank payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const res = await this.api.get(`/getxmltraninfobyid/${providerTransactionId}`, {
        headers: {
          'Username': this.config.credentials.username,
          'Expassword': this.config.credentials.expassword,
        },
      });

      const responseCode = this.extractXmlValue(res.data, 'ResponseCode');
      const trnStatus = this.extractXmlValue(res.data, 'trnStatus');

      return {
        success: responseCode === '200',
        providerTransactionId,
        status: trnStatus === 'Paid' ? 'completed' : 'pending',
        message: this.extractXmlValue(res.data, 'Responsedescription'),
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  private extractXmlValue(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'i'));
    return match ? match[1] : '';
  }

  async validateCredentials(): Promise<boolean> {
    try {
      const res = await this.api.post('/t24validation', '<?xml version="1.0" encoding="UTF-8"?><Transaction><beneaccountno>0200014001577</beneaccountno></Transaction>');
      return this.extractXmlValue(res.data, 'ResponseCode') === '200';
    } catch {
      return false;
    }
  }
}

// ============================================
// BRAC BANK PROVIDER (Bangladesh - OAuth2 + JWE)
// ============================================
@Injectable()
export class BracBankProvider extends PayoutProvider {
  protected readonly providerCode = 'brac_bank';
  private api!: AxiosInstance;
  private config!: ProviderConfig;
  private bearerToken!: string;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async getToken(): Promise<string> {
    if (this.bearerToken) return this.bearerToken;

    const { basicAuthHeader } = this.config.credentials;
    const res = await this.api.post('/oauth/Token', {}, {
      headers: {
        'Authorization': basicAuthHeader || 'Basic U1BfVzpBYmNkMTIzNDU2Ny4=',
        'Content-Type': 'application/json',
      },
    });
    this.bearerToken = res.data.Data?.Token;
    return this.bearerToken;
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const token = await this.getToken();

      const payload = {
        TTReferenceNo: request.reference,
        BeneficiaryName: request.recipientName,
        BeneficiaryPhoneNo: request.recipientPhone || '',
        BeneficiaryIdentityType: request.metadata?.beneficiaryIdType || 'CCPT',
        BeneficiaryIdentityNumber: request.metadata?.beneficiaryIdNumber || '',
        BeneficiaryFather: request.metadata?.beneficiaryFather || '',
        BeneficiaryMother: request.metadata?.beneficiaryMother || '',
        BeneficiaryDob: request.metadata?.beneficiaryDob || '',
        BeneficiaryAddress: request.metadata?.beneficiaryAddress || '',
        BeneficiaryRelation: request.metadata?.beneficiaryRelation || 'PARE',
        BeneficiaryAccountNo: request.recipientAccount,
        DistrictISOCode: request.metadata?.districtIsoCode || '',
        ThanaCode: request.metadata?.thanaCode || '',
        TTAmount: request.amount,
        SenderName: request.metadata?.senderName || 'Sender',
        SenderAddress: request.metadata?.senderAddress || '',
        SenderCountryCode: request.metadata?.senderCountryCode || 'USA',
        ModeOfPayment: request.metadata?.modeOfPayment || '01',
        SenderCurrencyCode: request.metadata?.senderCurrencyCode || 'USD',
        SenderDocumentType: request.metadata?.senderDocumentType || 'CCPT',
        SenderDocumentNumber: request.metadata?.senderDocumentNumber || '',
        SenderMsisdn: request.metadata?.senderMsisdn || '',
        SenderNationality: request.metadata?.senderNationality || 'BGD',
        SenderDob: request.metadata?.senderDob || '',
        RoutingNo: request.recipientBankCode || '',
        Purpose: request.purpose || 'FAMI',
        BeneficiaryCountry: request.metadata?.beneficiaryCountry || 'BGD',
        BeneficiaryCurrency: request.currency,
        WalletPartner: request.metadata?.walletPartner || '',
        SourceOfFunds: request.metadata?.sourceOfFunds || 'EMIN',
        SenderGender: request.metadata?.senderGender || 'M',
        BeneficiaryGender: request.metadata?.beneficiaryGender || 'M',
        SenderConversionRate: request.metadata?.conversionRate || '',
        SenderAmount: request.metadata?.senderAmount || '',
      };

      const res = await this.api.post('/Transaction/postTransaction', payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/plain',
        },
      });

      return {
        success: res.data.Success === true || res.data.StatusCode === '801',
        providerTransactionId: request.reference,
        status: res.data.Success ? 'initiated' : 'failed',
        message: res.data.StatusDescription || 'Transaction submitted',
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`Brac Bank payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const token = await this.getToken();
      const res = await this.api.post('/Transaction/queryTransaction', {
        TTReferenceNo: providerTransactionId,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return {
        success: true,
        providerTransactionId,
        status: res.data.TransactionStatus === 'COMPLETED' ? 'completed' : 'pending',
        message: res.data.StatusDescription,
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getToken();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// PRIME BANK PROVIDER (Bangladesh - Token + AES)
// ============================================
@Injectable()
export class PrimeBankProvider extends PayoutProvider {
  protected readonly providerCode = 'prime_bank';
  private api!: AxiosInstance;
  private config!: ProviderConfig;
  private authToken!: string;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async getToken(): Promise<string> {
    if (this.authToken) return this.authToken;

    const { corporateId, userId, password, enckey } = this.config.credentials;
    const res = await this.api.post('/getToken', {
      UserId: userId,
      CorporateId: corporateId,
      Password: password,
    }, {
      headers: { enckey },
    });
    this.authToken = res.data.Token;
    return this.authToken;
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const token = await this.getToken();
      const { corporateId, userId, enckey } = this.config.credentials;

      const payload = {
        CorporateId: corporateId,
        UserId: userId,
        Transaction: [{
          BeneficiaryDetails: {
            BeneficiaryName: request.recipientName,
            BeneficiaryAddress: request.metadata?.beneficiaryAddress || '',
            BeneficiaryCountry: 'BD',
          },
          RemitterDetails: {
            RemitterName: request.metadata?.senderName || 'Sender',
            RemitterAddress: request.metadata?.senderAddress || '',
            RemitterCountry: request.metadata?.senderCountry || 'SG',
            RemitterOccupation: request.metadata?.senderOccupation || '',
            RemitterDob: request.metadata?.senderDob || '',
            RemitterIDType: request.metadata?.senderIdType || 'Citizen',
            RemitterIDNo: request.metadata?.senderIdNo || '',
          },
          TransactionDetails: {
            TransactionReferenceNo: request.reference,
            TransferAmount: request.amount.toString(),
            Currency: request.currency,
            MandateType: request.metadata?.mandateType || 'BEFTN',
            BeneficiaryAccountNo: request.recipientAccount,
            BankName: request.recipientBankName || '',
            BankBranch: request.metadata?.bankBranch || '',
            RoutingNumber: request.recipientBankCode || '',
            TwoPercentageConsent: request.metadata?.twoPercentConsent || 'Y',
            PurposeCode: request.metadata?.purposeCode || '',
            TransactionDate: new Date().toLocaleDateString('en-GB'),
          },
        }],
      };

      const res = await this.api.post('/sendTransaction', payload, {
        headers: { enckey, token },
      });

      return {
        success: res.data.ResponseCode === '200' || res.data.status === 'success',
        providerTransactionId: request.reference,
        status: 'initiated',
        message: res.data.ResponseMessage || 'Transaction submitted',
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`Prime Bank payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const token = await this.getToken();
      const res = await this.api.post('/transactionStatus', {
        CorporateId: this.config.credentials.corporateId,
        UserId: this.config.credentials.userId,
        TransactionReferenceNo: providerTransactionId,
      }, {
        headers: { token, enckey: this.config.credentials.enckey },
      });

      return {
        success: true,
        providerTransactionId,
        status: res.data.Status === 'COMPLETED' ? 'completed' : 'pending',
        message: res.data.StatusMessage,
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getToken();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// STANDARD BANK PROVIDER (Bangladesh - SOAP + Salted Hash)
// ============================================
@Injectable()
export class StandardBankProvider extends PayoutProvider {
  protected readonly providerCode = 'standard_bank';
  private api!: AxiosInstance;
  private config!: ProviderConfig;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
      },
    });
  }

  private generateSaltedValue(txnNo: string, amount: string, accountNo: string): string {
    const { apiSalt } = this.config.credentials;
    const raw = `${txnNo}${amount}${apiSalt}${accountNo}`;
    return Buffer.from(raw).toString('base64');
  }

  private buildSoapRequest(action: string, entries: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:con="http://controller.ws4Rms.pro.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <con:${action}>
      <wsParam>
        <apiUser>${this.config.credentials.apiUser}</apiUser>
        <apiKey>${this.config.credentials.apiKey}</apiKey>
        <apiPass>${this.config.credentials.apiPass}</apiPass>
        <productCode>${this.config.credentials.productCode}</productCode>
        <paramArray>
          ${entries}
        </paramArray>
      </wsParam>
    </con:${action}>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const saltedValue = this.generateSaltedValue(
        request.reference,
        request.amount.toFixed(1),
        request.recipientAccount
      );

      const entries = `
<entry><key>txnNo</key><value>${request.reference}</value></entry>
<entry><key>amountToPay</key><value>${request.amount.toFixed(1)}</value></entry>
<entry><key>currency</key><value>${request.currency}</value></entry>
<entry><key>saltedValue</key><value>${saltedValue}</value></entry>
<entry><key>sendingPurpose</key><value>${request.purpose || 'Family Maintenance'}</value></entry>
<entry><key>senderFullName</key><value>${request.metadata?.senderName || 'Sender'}</value></entry>
<entry><key>senderContactNo</key><value>${request.metadata?.senderPhone || ''}</value></entry>
<entry><key>senderOccupationName</key><value>${request.metadata?.senderOccupation || 'Engineer'}</value></entry>
<entry><key>senderIncomeSourceName</key><value>${request.metadata?.senderIncomeSource || 'Salary'}</value></entry>
<entry><key>receiverFullName</key><value>${request.recipientName}</value></entry>
<entry><key>receiverContactNo</key><value>${request.recipientPhone || ''}</value></entry>
<entry><key>paymentMode</key><value>${request.metadata?.paymentMode || 'BANK'}</value></entry>
<entry><key>bankName</key><value>${request.recipientBankName || ''}</value></entry>
<entry><key>brnName</key><value>${request.metadata?.branchName || ''}</value></entry>
<entry><key>routingNo</key><value>${request.recipientBankCode || ''}</value></entry>
<entry><key>bankAccountNo</key><value>${request.recipientAccount}</value></entry>
<entry><key>sendCountryCode</key><value>${request.metadata?.senderCountry || 'PK'}</value></entry>
<entry><key>sendCountryName</key><value>${request.metadata?.senderCountryName || ''}</value></entry>`;

      const soapBody = this.buildSoapRequest('submitRemitInfo', entries);

      const res = await this.api.post('', soapBody, {
        headers: { SOAPAction: '' },
      });

      const rtnFlag = this.extractXmlValue(res.data, 'rtnFlag');
      const rtnMsg = this.extractXmlValue(res.data, 'rtnMsg');

      return {
        success: rtnFlag === 'Success',
        providerTransactionId: request.reference,
        status: rtnFlag === 'Success' ? 'initiated' : 'failed',
        message: rtnMsg,
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`Standard Bank payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const entries = `<entry><key>txnNo</key><value>${providerTransactionId}</value></entry>`;
      const soapBody = this.buildSoapRequest('queryRemitInfo', entries);

      const res = await this.api.post('', soapBody, {
        headers: { SOAPAction: '' },
      });

      const rtnFlag = this.extractXmlValue(res.data, 'rtnFlag');
      const trnStatus = this.extractXmlValue(res.data, 'trnStatus');

      return {
        success: rtnFlag === 'Success',
        providerTransactionId,
        status: trnStatus === 'Paid' ? 'completed' : 'pending',
        message: this.extractXmlValue(res.data, 'rtnMsg'),
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  private extractXmlValue(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'i'));
    return match ? match[1] : '';
  }

  async validateCredentials(): Promise<boolean> {
    try {
      const entries = `<entry><key>txnNo</key><value>test</value></entry>`;
      const soapBody = this.buildSoapRequest('queryRemitInfo', entries);
      const res = await this.api.post('', soapBody);
      return this.extractXmlValue(res.data, 'rtnFlag') !== '';
    } catch {
      return false;
    }
  }
}

// ============================================
// UCB PROVIDER (Bangladesh - Session + DLL Encryption)
// ============================================
@Injectable()
export class UcbProvider extends PayoutProvider {
  protected readonly providerCode = 'ucb';
  private api!: AxiosInstance;
  private config!: ProviderConfig;
  private sessionId!: string;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async authenticate(): Promise<string> {
    if (this.sessionId) return this.sessionId;

    const { userId, password } = this.config.credentials;
    const res = await this.api.post('/URemitJSONAuthentication?QueryType=2', {
      UserID: userId,
      Password: password,
    });
    this.sessionId = res.data.SessionID;
    return this.sessionId;
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const sessionId = await this.authenticate();
      const { transactionPassword } = this.config.credentials;
      const modeOfPayment = request.metadata?.modeOfPayment || '001';

      const payload: any = {
        SessionID: sessionId,
        TransactionPassword: transactionPassword,
        TransactionReferenceID: request.reference,
        SenderName: request.metadata?.senderName || 'Sender',
        SenderAddress: request.metadata?.senderAddress || '',
        SenderMobileNo: request.metadata?.senderPhone || '',
        SenderCountryCode: request.metadata?.senderCountryCode || 'BGD',
        BeneficiaryName: request.recipientName,
        BeneficiaryAddress: request.metadata?.beneficiaryAddress || 'Bangladesh',
        BeneficiaryMobileNo: request.recipientPhone || '',
        BeneficiaryIdentityType: request.metadata?.beneficiaryIdType || 'PP',
        BeneficiaryIdentityInfo: request.metadata?.beneficiaryIdInfo || '',
        TransactionAmount: request.amount.toFixed(2),
        ModeOfPayment: modeOfPayment,
        UserID: this.config.credentials.userId,
        FreeText: request.purpose || 'UCB Trans',
        SenderPassportNo: request.metadata?.senderPassportNo || '',
        SenderOtherIDType: request.metadata?.senderOtherIdType || '',
        SenderOtherIDNo: request.metadata?.senderOtherIdNo || '',
        SourceForeignCCY: request.metadata?.sourceCurrency || 'USD',
        ConversionRate: request.metadata?.conversionRate || '1.0',
        RemmitedAmount: request.metadata?.remittedAmount || request.amount.toString(),
        NationalityOfRemmiter: request.metadata?.senderNationality || 'UAE',
      };

      if (modeOfPayment === '001' || modeOfPayment === '006' || modeOfPayment === '007') {
        payload.BeneficiaryAccountNo = request.recipientAccount;
      }
      if (modeOfPayment === '006') {
        payload.BeneficiaryRoutingNo = request.recipientBankCode || '';
      }

      const res = await this.api.post('/InitiateJSONURemitTransaction?QueryType=2', payload);

      return {
        success: res.data.StatusCode === '0000',
        providerTransactionId: request.reference,
        status: res.data.StatusCode === '0000' ? 'initiated' : 'failed',
        message: res.data.StatusCode === '0000' ? 'Transaction initiated' : res.data.StatusMessage,
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`UCB payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const res = await this.api.post('/QueryJSONTransactionPost', {
        TransactionReferenceID: providerTransactionId,
        PostedDate: '',
        UserID: this.config.credentials.userId,
      });

      const data = Array.isArray(res.data) ? res.data[0] : res.data;
      return {
        success: data?.RequestStatus === '7011',
        providerTransactionId,
        status: data?.TransactionStatus === '0100' ? 'completed' : 'pending',
        message: data?.RequestStatus === '7011' ? 'Query successful' : 'Query failed',
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.authenticate();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// DHAKA BANK PROVIDER (Bangladesh - OAuth2 JWT)
// ============================================
@Injectable()
export class DhakaBankProvider extends PayoutProvider {
  protected readonly providerCode = 'dhaka_bank';
  private config!: ProviderConfig;
  private publicApi!: AxiosInstance;
  private secureApi!: AxiosInstance;
  private accessToken!: string;
  private tokenExpiry!: Date;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.publicApi = axios.create({
      baseURL: config.credentials.publicBaseUrl || config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
    this.secureApi = axios.create({
      baseURL: config.credentials.secureBaseUrl || config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.secureApi.interceptors.request.use(async (cfg) => {
      if (!this.accessToken || new Date() > this.tokenExpiry) {
        await this.refreshToken();
      }
      cfg.headers['Authorization'] = `Bearer ${this.accessToken}`;
      return cfg;
    });
  }

  private async refreshToken(): Promise<void> {
    const { username, password } = this.config.credentials;
    const res = await this.publicApi.post('/get-access-token', { username, password });
    this.accessToken = res.data.accessToken;
    this.tokenExpiry = new Date(res.data.expireOn);
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const now = new Date();
      now.setMinutes(now.getMinutes() + 1, 0, 0);
      const reqDateTime = now.toISOString().replace('T', ' ').substring(0, 19);

      const payload = {
        refNo: request.reference,
        beneficiaryName: request.recipientName,
        beneficiaryPhone: request.recipientPhone || '',
        beneficiaryAdress: request.metadata?.beneficiaryAddress || '',
        beneficiaryRelation: request.metadata?.beneficiaryRelation || '',
        beneficiaryAccountNo: request.recipientAccount,
        beneficiaryBank: request.recipientBankName || '',
        beneficiaryBranch: request.metadata?.beneficiaryBranch || '',
        beneficiaryGender: request.metadata?.beneficiaryGender || 'M',
        branchCode: request.recipientBankCode || '',
        paymentDate: new Date().toISOString().split('T')[0],
        amount: request.amount,
        purpose: request.purpose || 'Family Maintenance',
        currencyCode: request.currency,
        description: request.metadata?.description || 'Remittance',
        senderName: request.metadata?.senderName || 'Sender',
        senderAddress: request.metadata?.senderAddress || '',
        senderGender: request.metadata?.senderGender || 'M',
        senderNationality: request.metadata?.senderNationality || 'Bangladeshi',
        originCountry: request.metadata?.originCountry || 'United Kingdom',
        transactionDate: new Date().toISOString().split('T')[0],
        beneficiaryBranchRouting: request.metadata?.beneficiaryBranchRouting || '',
        foreignCurrencyAmount: request.metadata?.foreignCurrencyAmount || 0,
        reqDateTime,
        convRate: request.metadata?.convRate || '1.0',
        extraParams: request.metadata?.extraParams || {},
      };

      const res = await this.secureApi.post('/send-remittance', payload);

      return {
        success: res.data.status === '0000',
        providerTransactionId: res.data.uniqueId,
        status: res.data.remittanceStatus === 'RECEIVED' ? 'initiated' : 'failed',
        message: res.data.msg || 'Remittance submitted',
        rawResponse: res.data,
      };
    } catch (err) {
      this.logger.error(`Dhaka Bank payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const res = await this.secureApi.post('/get-remittance-bulk-status', [
        { refNo: providerTransactionId },
        { refNo: `${providerTransactionId}_dummy` },
      ]);

      const list = res.data.remittanceStatusList || [];
      const tx = list.find((t: any) => t.refNo === providerTransactionId);

      if (!tx) {
        return { success: false, status: 'failed', message: 'Transaction not found in bulk response' };
      }

      return {
        success: true,
        providerTransactionId,
        status: tx.remittanceStatus === 'SUCCESS' ? 'completed' : tx.remittanceStatus === 'FAILED' ? 'failed' : 'pending',
        message: tx.apiMsg || tx.remittanceStatus,
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.refreshToken();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// ABL (ALLIED BANK LIMITED) PROVIDER (Pakistan - SOAP)
// ============================================
@Injectable()
export class AblProvider extends PayoutProvider {
  protected readonly providerCode = 'abl';
  private api!: AxiosInstance;
  private config!: ProviderConfig;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': config.baseUrl.includes('hrscloud') ? 'http://hrscloud/pushservice/get_acct_title' : '',
      },
    });
  }

  private buildSoapAuth(): string {
    const { agentCode, password, userId } = this.config.credentials;
    return `
        <auth>
          <agent_code>${agentCode}</agent_code>
          <password>${password}</password>
          <user_id>${userId}</user_id>
        </auth>`;
  }

  private buildSoapEnvelope(body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://hrscloud/pushservice/">
  <soapenv:Header/>
  <soapenv:Body>
    ${body}
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  private extractXmlValue(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'i'));
    return match ? match[1] : '';
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      // Step 1: Get account title (validation)
      const titleSoap = this.buildSoapEnvelope(`
        <tns:get_acct_title>
          ${this.buildSoapAuth()}
          <cnic>${request.metadata?.beneficiaryCnic || ''}</cnic>
          <Beneficiary_Account>${request.recipientAccount}</Beneficiary_Account>
          <branchid>${request.metadata?.branchId || ''}</branchid>
          <Beneficiary_Bank>${request.recipientBankName || ''}</Beneficiary_Bank>
          <amount>${request.amount}</amount>
        </tns:get_acct_title>`);

      const titleRes = await this.api.post('', titleSoap);
      const titleCode = this.extractXmlValue(titleRes.data, 'Response_Code');
      const pin = this.extractXmlValue(titleRes.data, 'pin');

      if (titleCode !== '000' && titleCode !== '00') {
        return {
          success: false,
          status: 'failed',
          message: this.extractXmlValue(titleRes.data, 'Response_Text') || 'Account validation failed',
          rawResponse: titleRes.data,
        };
      }

      // Step 2: Send funds transfer
      const transferSoap = this.buildSoapEnvelope(`
        <tns:send_online_fundsTransfer>
          ${this.buildSoapAuth()}
          <RRN>${request.reference}</RRN>
          <txns>
            <transaction_reference_id>${request.reference}</transaction_reference_id>
            <pin>${pin}</pin>
            <payment_mode>${request.metadata?.paymentMode || 'ACCOUNT'}</payment_mode>
            <beneficiary_currency_amount>${request.amount}</beneficiary_currency_amount>
            <beneficiary_currency>${request.currency}</beneficiary_currency>
            <beneficiary_bank>${request.recipientBankName || ''}</beneficiary_bank>
            <beneficiary_account_number>${request.recipientAccount}</beneficiary_account_number>
            <beneficiary_branch_code>${request.recipientBankCode || ''}</beneficiary_branch_code>
            <BeneficiaryAccountnoWithIBAN>${request.metadata?.iban || ''}</BeneficiaryAccountnoWithIBAN>
            <beneficiary_name>${request.recipientName}</beneficiary_name>
            <beneficiary_branch_name>${request.metadata?.branchName || ''}</beneficiary_branch_name>
            <beneficiary_branch_address>${request.metadata?.branchAddress || ''}</beneficiary_branch_address>
            <beneficiary_address>${request.metadata?.beneficiaryAddress || ''}</beneficiary_address>
            <beneficiary_city>${request.metadata?.beneficiaryCity || ''}</beneficiary_city>
            <beneficiary_id_no>${request.metadata?.beneficiaryIdNo || ''}</beneficiary_id_no>
            <Beneficiary_Id_Type>${request.metadata?.beneficiaryIdType || ''}</Beneficiary_Id_Type>
            <beneficiary_account_title>${request.metadata?.accountTitle || ''}</beneficiary_account_title>
            <beneficiary_phone>${request.recipientPhone || ''}</beneficiary_phone>
            <beneficiary_email>${request.metadata?.beneficiaryEmail || ''}</beneficiary_email>
            <remitter_name>${request.metadata?.senderName || 'Sender'}</remitter_name>
            <remitter_address>${request.metadata?.senderAddress || ''}</remitter_address>
            <remitter_city>${request.metadata?.senderCity || ''}</remitter_city>
            <remitter_country>${request.metadata?.senderCountry || 'AE'}</remitter_country>
            <remitter_phone>${request.metadata?.senderPhone || ''}</remitter_phone>
            <remitter_email>${request.metadata?.senderEmail || ''}</remitter_email>
            <remarks>${request.purpose || 'Home Remittance'}</remarks>
          </txns>
        </tns:send_online_fundsTransfer>`);

      const transferRes = await this.api.post('', transferSoap);
      const transferCode = this.extractXmlValue(transferRes.data, 'Response_Code');

      return {
        success: transferCode === '000' || transferCode === '00',
        providerTransactionId: request.reference,
        status: transferCode === '000' || transferCode === '00' ? 'initiated' : 'failed',
        message: this.extractXmlValue(transferRes.data, 'Response_Text'),
        rawResponse: transferRes.data,
      };
    } catch (err) {
      this.logger.error(`ABL payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const soapBody = this.buildSoapEnvelope(`
        <tns:get_transaction_status>
          ${this.buildSoapAuth()}
          <referenceNo>${providerTransactionId}</referenceNo>
        </tns:get_transaction_status>`);

      const res = await this.api.post('', soapBody);
      const responseCode = this.extractXmlValue(res.data, 'Response_Code');

      return {
        success: responseCode === '000' || responseCode === '00',
        providerTransactionId,
        status: responseCode === '000' || responseCode === '00' ? 'completed' : 'pending',
        message: this.extractXmlValue(res.data, 'Response_Text'),
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      const soapBody = this.buildSoapEnvelope(`
        <tns:get_agent_accnt_balance>
          ${this.buildSoapAuth()}
        </tns:get_agent_accnt_balance>`);
      const res = await this.api.post('', soapBody);
      const responseCode = this.extractXmlValue(res.data, 'Response_Code');
      return responseCode === '000' || responseCode === '00';
    } catch {
      return false;
    }
  }
}

// ============================================
// FAYSAL BANK (FBL) IBFT PROVIDER (Pakistan - REST/SOAP + MD5 Token)
// ============================================
@Injectable()
export class FaysalBankProvider extends PayoutProvider {
  protected readonly providerCode = 'faysal_bank';
  private api!: AxiosInstance;
  private config!: ProviderConfig;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.api = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private generateToken(stan: string): { token: string; strDate: string; strTime: string } {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const strDate = `${month}${day}`;
    const strTime = `${hours}${minutes}${seconds}`;
    const preSharedKey = this.config.credentials.preSharedKey || 'TEST';
    const raw = `${strDate}${strTime}${preSharedKey}${stan}`;
    const token = crypto.createHash('md5').update(raw).digest('hex');
    return { token, strDate, strTime };
  }

  private generateStan(): string {
    // 6-digit STAN, unique per day (use reference number suffix or random)
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutResponse> {
    try {
      const stan = this.generateStan();
      const { token, strDate, strTime } = this.generateToken(stan);
      const { username, password, apiKey } = this.config.credentials;

      // Step 1: Get account title (validation)
      const titlePayload = {
        auth: {
          username,
          password,
          apiKey,
          token,
          strDate,
          strTime,
          intSTAN: stan,
        },
        beneficiaryAccount: request.recipientAccount,
        beneficiaryBank: request.recipientBankName || '',
        branchCode: request.recipientBankCode || '',
        amount: request.amount.toString(),
      };

      const titleRes = await this.api.post('/services/MiddlewareServices/ESBHrs', titlePayload, {
        headers: { 'SOAPAction': 'get_acct_title' },
      });

      const titleData = typeof titleRes.data === 'string' ? this.parseSoapResponse(titleRes.data) : titleRes.data;
      if (titleData.Response_Code && titleData.Response_Code !== '000' && titleData.Response_Code !== '00') {
        return {
          success: false,
          status: 'failed',
          message: titleData.Response_Text || 'Account validation failed',
          rawResponse: titleRes.data,
        };
      }

      // Step 2: Post single remittance
      const remitStan = this.generateStan();
      const remitToken = this.generateToken(remitStan);
      const remitPayload = {
        auth: {
          username,
          password,
          apiKey,
          token: remitToken.token,
          strDate: remitToken.strDate,
          strTime: remitToken.strTime,
          intSTAN: remitStan,
        },
        RIN: request.reference,
        transactionReferenceId: request.reference,
        beneficiaryName: request.recipientName,
        beneficiaryAccountNumber: request.recipientAccount,
        beneficiaryBank: request.recipientBankName || '',
        beneficiaryBranchCode: request.recipientBankCode || '',
        beneficiaryCurrencyAmount: request.amount,
        beneficiaryCurrency: request.currency,
        paymentMode: request.metadata?.paymentMode || 'IBFT',
        remitterName: request.metadata?.senderName || 'Sender',
        remitterAddress: request.metadata?.senderAddress || '',
        remitterCity: request.metadata?.senderCity || '',
        remitterCountry: request.metadata?.senderCountry || 'AE',
        remitterPhone: request.metadata?.senderPhone || '',
        remitterEmail: request.metadata?.senderEmail || '',
        remarks: request.purpose || 'Home Remittance',
      };

      const remitRes = await this.api.post('/services/MiddlewareServices/ESBHrs', remitPayload, {
        headers: { 'SOAPAction': 'send_online_fundsTransfer' },
      });

      const remitData = typeof remitRes.data === 'string' ? this.parseSoapResponse(remitRes.data) : remitRes.data;

      return {
        success: remitData.Response_Code === '000' || remitData.Response_Code === '00',
        providerTransactionId: request.reference,
        status: remitData.Response_Code === '000' || remitData.Response_Code === '00' ? 'initiated' : 'failed',
        message: remitData.Response_Text || 'Remittance submitted',
        rawResponse: remitRes.data,
      };
    } catch (err) {
      this.logger.error(`Faysal Bank payout failed: ${(err as any).message}`);
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  async checkStatus(providerTransactionId: string): Promise<PayoutResponse> {
    try {
      const stan = this.generateStan();
      const { token, strDate, strTime } = this.generateToken(stan);
      const { username, password, apiKey } = this.config.credentials;

      const payload = {
        auth: {
          username,
          password,
          apiKey,
          token,
          strDate,
          strTime,
          intSTAN: stan,
        },
        referenceNo: providerTransactionId,
      };

      const res = await this.api.post('/services/MiddlewareServices/FRCTxnInq/StatusInquiry', payload, {
        headers: { 'SOAPAction': 'get_transaction_status' },
      });

      const data = typeof res.data === 'string' ? this.parseSoapResponse(res.data) : res.data;

      return {
        success: data.Response_Code === '000' || data.Response_Code === '00',
        providerTransactionId,
        status: data.Response_Code === '000' || data.Response_Code === '00' ? 'completed' : 'pending',
        message: data.Response_Text,
        rawResponse: res.data,
      };
    } catch (err) {
      return { success: false, status: 'failed', message: (err as any).message };
    }
  }

  private parseSoapResponse(xml: string): Record<string, string> {
    const result: Record<string, string> = {};
    const tags = ['Response_Code', 'Response_Text', 'pin', 'balance', 'status'];
    for (const tag of tags) {
      const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'i'));
      if (match) result[tag] = match[1];
    }
    return result;
  }

  async validateCredentials(): Promise<boolean> {
    try {
      const stan = this.generateStan();
      const { token, strDate, strTime } = this.generateToken(stan);
      const { username, password, apiKey } = this.config.credentials;

      const payload = {
        auth: {
          username,
          password,
          apiKey,
          token,
          strDate,
          strTime,
          intSTAN: stan,
        },
      };

      const res = await this.api.post('/services/MiddlewareServices/ESBHrs', payload, {
        headers: { 'SOAPAction': 'get_agent_accnt_balance' },
      });

      const data = typeof res.data === 'string' ? this.parseSoapResponse(res.data) : res.data;
      return data.Response_Code === '000' || data.Response_Code === '00';
    } catch {
      return false;
    }
  }
}
