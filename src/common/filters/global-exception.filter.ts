import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Single global exception filter. All errors are normalized to RFC 7807
 * problem-details responses.
 *
 *   {
 *     "type": "/errors/<slug>",
 *     "title": "<short summary>",
 *     "status": <http code>,
 *     "detail": "<message>",
 *     "instance": "<request path>",
 *     "errors"?: [...]      // class-validator field errors
 *   }
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<{ url: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal server error';
    let detail = 'Something went wrong.';
    let errors: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        title = exception.message;
        detail = response;
      } else if (typeof response === 'object' && response !== null) {
        const r = response as Record<string, unknown>;
        title = (r.error as string) ?? exception.message;
        detail = (r.message as string) ?? title;
        if (Array.isArray(r.message)) {
          detail = 'Validation failed';
          errors = r.message;
        }
      }
    } else if (exception instanceof Error) {
      detail = exception.message;
      this.logger.error(exception.stack ?? exception.message);
    }

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    res.status(status).json({
      type: `/errors/${slug || 'internal'}`,
      title,
      status,
      detail,
      instance: req.url,
      ...(errors ? { errors } : {}),
    });
  }
}
