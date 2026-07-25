import { IsString, Matches } from 'class-validator';

export class MarkReadDto {
  @IsString() @Matches(/^(public|supplier:.+)$/)
  roomKey!: string;
}
