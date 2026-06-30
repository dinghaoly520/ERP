import { IsString, IsIn, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResolveIssueDto {
  @ApiProperty({ description: 'Issue index in the results array' })
  @IsNumber()
  issueIndex: number;

  @ApiProperty({ enum: ['accept', 'reject'] })
  @IsIn(['accept', 'reject'])
  action: 'accept' | 'reject';

  @ApiPropertyOptional({ description: 'User-edited suggestion text' })
  @IsOptional()
  @IsString()
  editedSuggestion?: string;
}
