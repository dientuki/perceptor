import { 
  IsInt, 
  IsString, 
  IsOptional, 
  IsBoolean, 
  IsEnum, 
  IsDateString 
} from 'class-validator';
import { MediaStatus } from '@prisma/client';

export class CreateMovieDto {
  @IsInt()
  tmdbId: number;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  overview?: string;

  @IsOptional()
  @IsString()
  posterUrl?: string;

  @IsOptional()
  @IsDateString()
  releaseDate?: Date;

  @IsString()
  originalLanguage: string;

  @IsOptional()
  @IsBoolean()
  isLiveAction?: boolean;

  @IsOptional()
  @IsEnum(MediaStatus)
  status?: MediaStatus;

  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsInt()
  mediaSourceId?: number;
}