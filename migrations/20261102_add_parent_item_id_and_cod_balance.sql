-- Migration: 20261102_add_parent_item_id_and_cod_balance.sql
-- Description: Add parent_item_id to order_items and cod_balance_due to orders for robust multi-product lifecycle tracking

ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS parent_item_id UUID;

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS cod_balance_due NUMERIC(10,2);

