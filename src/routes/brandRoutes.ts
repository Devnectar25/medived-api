import express from 'express';
import { BrandController } from '../controllers/brandController';

const router = express.Router();

router.get('/', BrandController.getBrands);

export default router;
