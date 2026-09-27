import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const manager = request.manager;

    if (!manager || manager.role !== 'ADMIN') {
      throw new ForbiddenException('Reserve aux administrateurs');
    }

    return true;
  }
}
