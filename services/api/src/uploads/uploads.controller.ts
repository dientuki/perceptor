import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { UploadsService } from './uploads.service';

// Única ruta REST del proyecto — ver la nota en CLAUDE.md sobre por qué el
// browser le habla acá directo a la api en vez de por GraphQL: un archivo de
// 20GB no entra por una mutation ni por un Server Action de Next.
//
// El comodín va nombrado ('*path', no '*' suelto) porque Express 5
// (path-to-regexp 8) ya no acepta wildcards sin nombre.
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @All(['', '*path'])
  handle(@Req() req: Request, @Res() res: Response) {
    return this.uploads.server.handle(req, res);
  }
}
