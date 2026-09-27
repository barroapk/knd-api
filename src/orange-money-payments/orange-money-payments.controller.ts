import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { DeviceTokenGuard } from './device-token.guard';
import { OrangeMoneyPaymentsService } from './orange-money-payments.service';
import type { ReceivePaymentDto } from './orange-money-payments.types';

@Controller('webhooks/orange-money-payment')
@UseGuards(DeviceTokenGuard)
export class OrangeMoneyPaymentsController {
  constructor(private readonly paymentsService: OrangeMoneyPaymentsService) {}

  @Post()
  async receive(@Body() dto: ReceivePaymentDto, @Req() request: any) {
    return this.paymentsService.receivePayment(dto, request.device.id);
  }
}
