import { Request, Response } from 'express';
import { BrandService } from '../services/brandService';

export class BrandController {
    static async getBrands(req: Request, res: Response): Promise<void> {
        try {
            const data = await BrandService.getAllBrands();
            res.json({ success: true, data });
        } catch (error: any) {
            console.error("Error in getBrands:", error);
            res.status(500).json({ success: false, error: error.message || "Internal Server Error" });
        }
    }
}
