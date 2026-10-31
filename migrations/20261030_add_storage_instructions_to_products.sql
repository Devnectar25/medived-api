-- Migration: 20261030_add_storage_instructions_to_products.sql
-- Adds storage_instructions column to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS storage_instructions TEXT;

