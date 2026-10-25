import { createServer } from 'node:http';
import { request } from 'https';
import { connect } from 'node:http2';
import fastify from 'fastify';
import swagger from '@fastify/swagger';
import { fetch } from 'undici';

// Fixture: a port that reaches for an HTTP framework, server or client (forbidden, AD-1 and FR-11).
export const packageName = '@tecton/providers';
export const used = [createServer, request, connect, fastify, swagger, fetch];
