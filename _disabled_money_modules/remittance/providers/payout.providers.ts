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
  authType: 'oauth2' | 'apikey' | 'hmac' | 'basic' | 'otp_token';
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
  abstract getBalance?(): Promise<number>;
}

// ============================================
// PAYMOB PROVIDER (Egypt - OAuth2)
// ============================================
@Injectable()
export class PaymobProvider extends PayoutProvider {
  protected readonly providerCode = 'paymob';
  private api: AxiosInstance;
  private config: ProviderConfig;
  private accessToken: string;
  private tokenExpiry: Date;

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
      this.logger.error(`Paymob payout failed: ${err.message}`);
      return { success: false, status: 'failed', message: err.message };
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
      return { success: false, status: 'failed', message: err.message };
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
  private api: AxiosInstance;
  private config: ProviderConfig;

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
      this.logger.error(`Samsara payout failed: ${err.message}`);
      return { success: false, status: 'failed', message: err.message };
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
      return { success: false, status: 'failed', message: err.message };
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
  private api: AxiosInstance;
  private config: ProviderConfig;

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
      this.logger.error(`Khalti payout failed: ${err.message}`);
      return { success: false, status: 'failed', message: err.message };
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
      return { success: false, status: 'failed', message: err.message };
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
  private api: AxiosInstance;
  private config: ProviderConfig;

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
      this.logger.error(`Safepay payout failed: ${err.message}`);
      return { success: false, status: 'failed', message: err.message };
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
      return { success: false, status: 'failed', message: err.message };
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
  private api: AxiosInstance;
  private config: ProviderConfig;

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
      this.logger.error(`8B payout failed: ${err.message}`);
      return { success: false, status: 'failed', message: err.message };
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
      return { success: false, status: 'failed', message: err.message };
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
  private api: AxiosInstance;
  private config: ProviderConfig;

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
      this.logger.error(`HRC UBL payout failed: ${err.message}`);
      return { success: false, status: 'failed', message: err.message };
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
      return { success: false, status: 'failed', message: err.message };
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
  private api: AxiosInstance;
  private config: ProviderConfig;
  private authToken: string;

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
      this.logger.error(`HabibMetro payout failed: ${err.message}`);
      return { success: false, status: 'failed', message: err.message };
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
      return { success: false, status: 'failed', message: err.message };
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
