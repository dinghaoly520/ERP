import { IsString, IsIn, IsOptional, IsNotEmpty } from 'class-validator';

export class UpsertRequirementReviewDto {
  @IsString() @IsNotEmpty() requirementId: string;
  @IsIn(['qualification', 'technical', 'commercial']) category: string;
  @IsIn(['ack', 'dispute', 'doubt']) verdict: string;
  @IsString() @IsOptional() note?: string;
}
