import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

export interface SmsSendRequest {
  phoneNumber: string;
  message: string;
  type?: 'otp' | 'transaction' | 'marketing';
  senderId?: string;
}

export interface SmsSendResponse {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

interface SmsRouteConfig {
  name: string;
  enabled: boolean;
  priority: number; // 1 = highest
  credentials: Record<string, string>;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private routes: SmsRouteConfig[] = [];

  constructor() {
    this.loadRoutes();
  }

  private loadRoutes() {
    // Load from environment or database in production
    // For now, using hardcoded config based on the 4 routes provided
    this.routes = [
      {
        name: 'lifetimesms',
        enabled: process.env.SMS_ROUTE_1_ENABLED === 'true',
        priority: 1,
        credentials: {
          apiToken: process.env.SMS_ROUTE_1_API_TOKEN || '',
          apiSecret: process.env.SMS_ROUTE_1_API_SECRET || '',
          senderId: process.env.SMS_ROUTE_1_SENDER || 'Lifetimesms',
        },
      },
      {
        name: 'sendpk',
        enabled: process.env.SMS_ROUTE_2_ENABLED === 'true',
        priority: 2,
        credentials: {
          apiKey: process.env.SMS_ROUTE_2_API_KEY || '',
          senderId: process.env.SMS_ROUTE_2_SENDER || 'SenderID',
        },
      },
      {
        name: 'fastsmsalerts',
        enabled: process.env.SMS_ROUTE_3_ENABLED === 'true',
        priority: 3,
        credentials: {
          id: process.env.SMS_ROUTE_3_ID || '',
          pass: process.env.SMS_ROUTE_3_PASS || '',
          mask: process.env.SMS_ROUTE_3_MASK || '',
        },
      },
      {
        name: 'bsms',
        enabled: process.env.SMS_ROUTE_4_ENABLED === 'true',
        priority: 4,
        credentials: {
          key: process.env.SMS_ROUTE_4_KEY || '',
          sender: process.env.SMS_ROUTE_4_SENDER || 'DESIGNZ%26CO',
        },
      },
    ].filter(r => r.enabled).sort((a, b) => a.priority - b.priority);
  }

  async sendSms(request: SmsSendRequest): Promise<SmsSendResponse> {
    if (this.routes.length === 0) {
      return { success: false, error: 'No SMS routes configured', provider: 'none' };
    }

    // Try each route in priority order
    for (const route of this.routes) {
      try {
        const result = await this.sendViaRoute(route, request);
        if (result.success) {
          return result;
        }
        this.logger.warn(`SMS route ${route.name} failed, trying next...`);
      } catch (err: any) {
        this.logger.error(`SMS route ${route.name} error: ${err?.message}`);
      }
    }

    return { success: false, error: 'All SMS routes failed', provider: 'none' };
  }

  private async sendViaRoute(route: SmsRouteConfig, request: SmsSendRequest): Promise<SmsSendResponse> {
    switch (route.name) {
      case 'lifetimesms':
        return this.sendViaLifetimeSms(route.credentials, request);
      case 'sendpk':
        return this.sendViaSendPk(route.credentials, request);
      case 'fastsmsalerts':
        return this.sendViaFastSmsAlerts(route.credentials, request);
      case 'bsms':
        return this.sendViaBsms(route.credentials, request);
      default:
        return { success: false, error: 'Unknown route', provider: route.name };
    }
  }

  // Route 1: lifetimesms.com - JSON POST API
  private async sendViaLifetimeSms(creds: Record<string, string>, request: SmsSendRequest): Promise<SmsSendResponse> {
    const url = 'https://lifetimesms.com/json';
    const payload = {
      api_token: creds.apiToken,
      api_secret: creds.apiSecret,
      to: this.formatPakistanNumber(request.phoneNumber),
      from: request.senderId || creds.senderId,
      message: request.message,
    };

    const res = await axios.post(url, payload, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });

    // LifetimeSMS returns { status: 'success', message_id: '...' } or { status: 'error', message: '...' }
    if (res.data?.status === 'success') {
      return { success: true, messageId: res.data.message_id, provider: 'lifetimesms' };
    }
    return { success: false, error: res.data?.message || 'Unknown error', provider: 'lifetimesms' };
  }

  // Route 2: sendpk.com - GET API
  private async sendViaSendPk(creds: Record<string, string>, request: SmsSendRequest): Promise<SmsSendResponse> {
    const phone = this.formatPakistanNumber(request.phoneNumber).replace('+92', '92');
    const params = new URLSearchParams({
      api_key: creds.apiKey,
      mobile: phone,
      sender: encodeURIComponent(request.senderId || creds.senderId),
      message: encodeURIComponent(request.message),
      format: 'json',
    });

    const url = `https://sendpk.com/api/sms.php?${params.toString()}`;
    const res = await axios.get(url, { timeout: 30000 });

    // SendPK returns JSON with status
    if (res.data?.status === 'success' || res.data?.code === '200') {
      return { success: true, messageId: res.data.message_id || res.data.id, provider: 'sendpk' };
    }
    return { success: false, error: res.data?.message || 'Unknown error', provider: 'sendpk' };
  }

  // Route 3: fastsmsalerts.com - GET API (mask-based)
  private async sendViaFastSmsAlerts(creds: Record<string, string>, request: SmsSendRequest): Promise<SmsSendResponse> {
    const phone = this.formatPakistanNumber(request.phoneNumber).replace('+92', '');
    const params = new URLSearchParams({
      id: creds.id,
      pass: creds.pass,
      mask: creds.mask,
      to: phone,
      portable: '',
      lang: 'english',
      msg: encodeURIComponent(request.message),
    });

    const url = `http://fastsmsalerts.com/quicksms?${params.toString()}`;
    const res = await axios.get(url, { timeout: 30000 });

    // Check for success indicators in response text
    const responseText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    if (responseText.toLowerCase().includes('success') || responseText.toLowerCase().includes('sent')) {
      return { success: true, messageId: crypto.randomUUID(), provider: 'fastsmsalerts' };
    }
    return { success: false, error: responseText, provider: 'fastsmsalerts' };
  }

  // Route 4: bsms.its.com.pk - GET API (OTP-specific)
  private async sendViaBsms(creds: Record<string, string>, request: SmsSendRequest): Promise<SmsSendResponse> {
    const phone = this.formatPakistanNumber(request.phoneNumber).replace('+92', '');
    
    // Extract OTP code from message if type is OTP
    let otpCode = '';
    if (request.type === 'otp') {
      const otpMatch = request.message.match(/\d{4,6}/);
      otpCode = otpMatch ? otpMatch[0] : '';
    }

    const params = new URLSearchParams({
      key: creds.key,
      receiver: phone,
      sender: creds.sender,
      OtpCode: otpCode || request.message.slice(0, 6), // Use first 6 chars if no OTP found
    });

    const url = `http://bsms.its.com.pk/otpsms.php?${params.toString()}`;
    const res = await axios.get(url, { timeout: 30000 });

    const responseText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    if (responseText.toLowerCase().includes('success') || responseText.toLowerCase().includes('sent')) {
      return { success: true, messageId: crypto.randomUUID(), provider: 'bsms' };
    }
    return { success: false, error: responseText, provider: 'bsms' };
  }

  private formatPakistanNumber(phone: string): string {
    // Normalize to +92XXXXXXXXXX format
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    if (!cleaned.startsWith('92')) {
      cleaned = '92' + cleaned;
    }
    return '+' + cleaned;
  }

  // Health check for all routes
  async checkRoutesHealth(): Promise<Array<{ name: string; status: 'up' | 'down'; error?: string }>> {
    return Promise.all(
      this.routes.map(async (route) => {
        try {
          // Simple connectivity check - actual send would require valid credentials
          await this.sendViaRoute(route, {
            phoneNumber: '+923001234567',
            message: 'Health check',
            type: 'otp',
          });
          return { name: route.name, status: 'up' };
        } catch (err: any) {
          return { name: route.name, status: 'down', error: err?.message };
        }
      }),
    );
  }
}
