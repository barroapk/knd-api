import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DevicesService } from '../devices/devices.service';

@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(private readonly devicesService: DevicesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-device-token'];

    if (!token) {
      throw new UnauthorizedException('X-Device-Token manquant');
    }

    const device = await this.devicesService.verifyDeviceToken(token);

    if (!device) {
      throw new UnauthorizedException('Token invalide ou appareil desactive');
    }

    request.device = device;
    return true;
  }
}
