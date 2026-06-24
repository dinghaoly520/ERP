// apps/api/src/ai-bid-analysis/dto/add-bidder.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddBidderDto {
  @ApiProperty({ description: '投标单位名称' })
  @IsString()
  @IsNotEmpty()
  name: string;
}
