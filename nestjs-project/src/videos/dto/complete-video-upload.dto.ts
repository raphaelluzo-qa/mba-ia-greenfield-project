import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { VIDEO_MAX_PARTS } from '../videos.constants';

export class CompletedVideoPartDto {
  @ApiProperty({ minimum: 1, maximum: VIDEO_MAX_PARTS })
  @IsInt()
  @Min(1)
  @Max(VIDEO_MAX_PARTS)
  part_number: number;

  @ApiProperty()
  @IsString()
  etag: string;
}

export class CompleteVideoUploadDto {
  @ApiProperty({ type: [CompletedVideoPartDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompletedVideoPartDto)
  parts: CompletedVideoPartDto[];
}
