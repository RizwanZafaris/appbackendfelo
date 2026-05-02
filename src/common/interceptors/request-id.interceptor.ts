import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const requestId = request.headers['x-request-id'] || randomUUID();
    request.requestId = requestId;
    request.headers['x-request-id'] = requestId;

    const response = context.switchToHttp().getResponse();
    response.setHeader('x-request-id', requestId);

    return next.handle();
  }
}
