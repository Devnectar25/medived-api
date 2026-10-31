-- Migration: 20261030_add_medicine_size_to_products.sql
-- Adds medicine_size column to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS medicine_size TEXT;

