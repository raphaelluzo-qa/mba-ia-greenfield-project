import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { VIDEO_MAX_PARTS } from '../videos.constants';

export class PresignVideoPartDto {
  @ApiProperty({ minimum: 1, maximum: VIDEO_MAX_PARTS })
  @IsInt()
  @Min(1)
  @Max(VIDEO_MAX_PARTS)
  part_number: number;
}
