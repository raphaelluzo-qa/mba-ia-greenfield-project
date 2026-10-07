import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { VIDEO_MAX_SIZE_BYTES } from '../videos.constants';

export class CreateVideoDraftDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  channel_id: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ minimum: 1, maximum: VIDEO_MAX_SIZE_BYTES })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(VIDEO_MAX_SIZE_BYTES)
  size_bytes: number;

  @ApiProperty({ example: 'video/mp4' })
  @IsString()
  mime_type: string;
}
