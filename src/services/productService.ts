import { ProductDao } from '../dao/productDao';

export class ProductService {
    static async getAllProducts() {
        return await ProductDao.getAllProducts();
    }

    static async getProductById(id: string | number) {
        return await ProductDao.getProductById(id);
    }
}
