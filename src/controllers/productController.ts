import { Request, Response } from 'express';
import { ProductService } from '../services/productService';

export class ProductController {
    static async getProducts(req: Request, res: Response): Promise<void> {
        try {
            const data = await ProductService.getAllProducts();
            res.json({ success: true, data });
        } catch (error) {
            res.status(500).json({ success: false, error: "Internal Server Error" });
        }
    }

    static async getProduct(req: Request, res: Response): Promise<void> {
        try {
            const id = req.params.id;
            const data = await ProductService.getProductById(id);

            if (!data) {
                res.status(404).json({ success: false, message: "Not Found" });
                return;
            }

            res.json({ success: true, data });
        } catch (error) {
            res.status(500).json({ success: false, error: "Internal Server Error" });
        }
    }
}
