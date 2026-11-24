import { Module } from '@nestjs/common';
import { LibraryLocationModule } from '@/library-location/library-location.module';
import { SubtitleEmbedModule } from '@/subtitle-embed/subtitle-embed.module';
import { SubtitleUploadResolver } from './subtitle-upload.resolver';
import { SubtitleUploadService } from './subtitle-upload.service';

// Spec 124
@Module({
  imports: [SubtitleEmbedModule, LibraryLocationModule],
  providers: [SubtitleUploadService, SubtitleUploadResolver],
})
export class SubtitleUploadModule {}
