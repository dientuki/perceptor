import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service'; // Ajustá la ruta según tu estructura
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';

@Injectable()
export class MoviesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createMovieDto: CreateMovieDto) {
    return this.prisma.movie.create({
      data: createMovieDto,
    });
  }

  async findAll() {
    return this.prisma.movie.findMany({
      orderBy: { createdAt: 'desc' }, // Las más recientes primero
      include: {
        downloadTask: true,
        processJobs: true,
      },
    });
  }

  async findOneFromDb(id: number) {
    return this.prisma.movie.findUnique({
      where: { id },
      include: {
        downloadTask: true,
        processJobs: true,
      },
    });
  }

  async update(id: number, updateMovieDto: UpdateMovieDto) {
    await this.findOneFromDb(id); // Valida que exista antes de actualizar

    return this.prisma.movie.update({
      where: { id },
      data: updateMovieDto,
    });
  }

  async remove(id: number) {
    await this.findOneFromDb(id); // Valida que exista

    return this.prisma.movie.delete({
      where: { id },
    });
  }
}