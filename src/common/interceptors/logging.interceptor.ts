import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip, headers, body } = request;
    const requestId = request.requestId || 'unknown';
    const userAgent = headers['user-agent'] || 'unknown';
    const userId = request.user?.id || 'anonymous';

    const startTime = Date.now();

    // Redact sensitive fields from body
    const sanitizedBody = this.sanitizeBody(body);

    return next.handle().pipe(
      tap({
        next: (data) => {
          const duration = Date.now() - startTime;
          const statusCode = context.switchToHttp().getResponse().statusCode;
          
          this.logger.log({
            event: 'http_request',
            requestId,
            userId,
            method,
            url,
            ip,
            userAgent,
            statusCode,
            durationMs: duration,
            body: sanitizedBody,
            timestamp: new Date().toISOString(),
          });
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          
          this.logger.error({
            event: 'http_error',
            requestId,
            userId,
            method,
            url,
            ip,
            statusCode: error.status || 500,
            durationMs: duration,
            errorMessage: error.message,
            errorCode: error.code,
            timestamp: new Date().toISOString(),
          });
        },
      }),
    );
  }

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') return body;
    
    const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'credential', 'ssn', 'cnic'];
    const sanitized = { ...body };
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
}
