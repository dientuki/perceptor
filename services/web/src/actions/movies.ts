'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { fetchGraphQL } from '@/lib/graphql-client';
import { CONFIG } from '@/lib/config';

const LOGIN_MUTATION = `
  mutation Login($loginInput: LoginInput!) {
    login(loginInput: $loginInput) {
      access_token
      user {
        id
        name
        email
      }
    }
  }
`

export interface Movie {
  id: string;
  tmdbId: number;
  title: string;
  overview?: string;
  posterUrl?: string;
  releaseDate?: string;
  originalLanguage: string;
  isLiveAction: boolean;
  status: string;
  filePath?: string;
}

export async function getMovies(): Promise<Movie[]> {
  const query = `
    query GetStoredMovies {
      movies {
        id
        overview
        title
        posterUrl
        releaseDate
      }
    }
  `;

  const { data } = await fetchGraphQL<{ movies: Movie[] }>(query);

  return data.movies;
}