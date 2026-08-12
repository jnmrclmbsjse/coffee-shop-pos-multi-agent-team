import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { SelectableStaffController } from './selectable-staff.controller';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [StaffController, SelectableStaffController],
  providers: [StaffService],
})
export class StaffModule {}
