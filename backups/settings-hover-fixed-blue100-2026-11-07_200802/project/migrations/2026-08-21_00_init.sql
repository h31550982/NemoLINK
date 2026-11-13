-- Migration: 2026-08-21_init
-- Idempotent — safe to rerun. Matches schema.sql as of this date.
-- Creates the extension baseline and the shared platform schema.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE SCHEMA IF NOT EXISTS platform;
