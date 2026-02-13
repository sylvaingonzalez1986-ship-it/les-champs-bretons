-- Fix double "images/images/" prefix caused by previous migration
UPDATE public.producers
SET image = substring(image from 8)
WHERE image LIKE 'images/images/%';

UPDATE public.products
SET image = substring(image from 8)
WHERE image LIKE 'images/images/%';
