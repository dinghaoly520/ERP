import { IsBoolean } from 'class-validator';

export class ConfirmActionDto {
  @IsBoolean()
  confirmed: boolean;
}
