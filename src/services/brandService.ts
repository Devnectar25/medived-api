import { BrandDao } from '../dao/brandDao';

export class BrandService {
    static async getAllBrands() {
        return await BrandDao.getAllBrands();
    }
}
