import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete, 
  ParseIntPipe 
} from '@nestjs/common';
import { MoviesService } from './movies.service';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';

@Controller('movies')
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  @Post()
  create(@Body() createMovieDto: CreateMovieDto) {
    return this.moviesService.create(createMovieDto);
  }

  @Get()
  findAll() {
    // Dead code: this controller is never registered in movies.module.ts
    // (no `controllers` array), so this route never actually executes.
    // Passing '' keeps it compiling after 005-movie-search scoped
    // MoviesService.findAll() to a userId; it is not a real caller.
    return this.moviesService.findAll('');
  }

  @Get(':id')
  findOneFromDb(@Param('id', ParseIntPipe) id: number) {
    return this.moviesService.findOneFromDb(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number, 
    @Body() updateMovieDto: UpdateMovieDto
  ) {
    return this.moviesService.update(id, updateMovieDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.moviesService.remove(id);
  }
}