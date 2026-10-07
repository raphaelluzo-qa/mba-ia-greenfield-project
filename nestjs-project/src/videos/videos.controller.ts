import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  Headers,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { CreateVideoDraftDto } from './dto/create-video-draft.dto';
import { PresignVideoPartDto } from './dto/presign-video-part.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('drafts')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Create a video draft',
    description:
      'Creates an authenticated multipart upload plan without proxying video bytes.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft and presigned upload plan created',
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication required',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Channel is not owned by the user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 422,
    description: 'Video is too large',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  createDraft(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDraftDto,
  ) {
    return this.videosService.createDraft(user, dto);
  }

  @Post(':id/parts')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Sign an upload part',
    description: 'Returns a presigned URL for one multipart upload part.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Part URL created' })
  @ApiResponse({
    status: 401,
    description: 'Authentication required',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Video is not owned by the user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  presignPart(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PresignVideoPartDto,
  ) {
    return this.videosService.presignPart(user, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Verifies the multipart object and queues asynchronous processing idempotently.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 202,
    description: 'Processing queued or already started',
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication required',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Video is not owned by the user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 422,
    description: 'Upload object is missing or has an invalid size',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  complete(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CompleteVideoUploadDto,
  ) {
    return this.videosService.completeUpload(user, id, dto);
  }

  @Public()
  @Get(':publicKey/stream')
  @ApiOperation({
    summary: 'Stream a ready video',
    description:
      'Streams a ready video from object storage and supports byte ranges.',
  })
  @ApiParam({ name: 'publicKey' })
  @ApiResponse({ status: 200, description: 'Video stream' })
  @ApiResponse({ status: 206, description: 'Partial video stream' })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('publicKey') publicKey: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const playback = await this.videosService.getPublicPlayback(
      publicKey,
      range,
    );
    response.status(playback.statusCode).set({
      'Content-Type': playback.contentType,
      'Content-Length': playback.contentLength.toString(),
      'Accept-Ranges': 'bytes',
      ...(playback.contentRange
        ? { 'Content-Range': playback.contentRange }
        : {}),
    });
    playback.body.pipe(response);
  }

  @Public()
  @Get(':publicKey/download')
  @ApiOperation({
    summary: 'Download a ready video',
    description:
      'Downloads a ready video from object storage and supports byte ranges.',
  })
  @ApiParam({ name: 'publicKey' })
  @ApiResponse({ status: 200, description: 'Video download' })
  @ApiResponse({ status: 206, description: 'Partial video download' })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @Param('publicKey') publicKey: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const playback = await this.videosService.getPublicPlayback(
      publicKey,
      range,
    );
    response.status(playback.statusCode).set({
      'Content-Type': playback.contentType,
      'Content-Disposition': `attachment; filename="${publicKey}"`,
      'Content-Length': playback.contentLength.toString(),
      'Accept-Ranges': 'bytes',
      ...(playback.contentRange
        ? { 'Content-Range': playback.contentRange }
        : {}),
    });
    playback.body.pipe(response);
  }

  @Get(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Inspect an owned video',
    description:
      'Returns a draft or processed video owned by the authenticated user.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Video details' })
  @ApiResponse({
    status: 401,
    description: 'Authentication required',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Video is not owned by the user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  inspect(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.videosService.getOwned(id, user);
  }
}
