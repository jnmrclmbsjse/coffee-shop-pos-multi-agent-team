import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { SelectableStaffController } from './selectable-staff.controller';
import { StaffEmploymentService } from './staff-employment.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [StaffController, SelectableStaffController],
  providers: [StaffService, StaffEmploymentService],
})
export class StaffModule {}
