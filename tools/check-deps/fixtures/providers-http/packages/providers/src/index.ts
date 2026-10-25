import { createServer } from 'node:http';
import { request } from 'https';
import fastify from 'fastify';
import swagger from '@fastify/swagger';

// Fixture: a port that reaches for an HTTP framework or server (forbidden, AD-1 and FR-11).
export const packageName = '@tecton/providers';
export const used = [createServer, request, fastify, swagger];
