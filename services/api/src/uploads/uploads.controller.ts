import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @All(['', '*path'])
  handle(@Req() req: Request, @Res() res: Response) {
    return this.uploads.server.handle(req, res);
  }
}
