const supabase = require('../config/supabaseClient');

const BUCKET_NAME = 'mediveda';

const fs = require('fs');

exports.uploadImage = async (file, folder = 'brand') => {
    try {
        if (!file || !file.originalname) {
            throw new Error('Invalid file: missing originalname');
        }
        
        // If it's a disk file (has path), use uploadFromFile
        if (file.path) {
            return await exports.uploadFromFile(file.path, `${folder}/${Date.now()}-${file.originalname}`, file.mimetype);
        }

        return await exports.uploadBuffer(file.buffer, `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}`, file.mimetype || 'image/jpeg');
    } catch (error) {
        throw error;
    }
};

exports.uploadFromFile = async (filePath, destinationPath, contentType) => {
    try {
        const fileBuffer = await fs.promises.readFile(filePath);
        return await exports.uploadBuffer(fileBuffer, destinationPath, contentType);
    } catch (error) {
        throw error;
    }
};

exports.uploadBuffer = async (buffer, filePath, contentType = 'application/pdf') => {
    try {
        const fileExt = filePath.split('.').pop();
        const finalPath = filePath.includes('.') ? filePath : `${filePath}.${contentType.split('/')[1] || 'bin'}`;

        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(finalPath, buffer, {
                contentType,
                upsert: true
            });

        if (error) {
            console.error("Supabase Storage Error Details:", {
                message: error.message,
                name: error.name,
                status: error.status,
                stack: error.stack
            });
            throw new Error(`Supabase Upload Error: ${error.message} (${error.status || 'No status'})`);
        }

        const { data: publicUrlData } = supabase.storage
            .from(BUCKET_NAME)
            .getPublicUrl(finalPath);

        return publicUrlData.publicUrl;
    } catch (error) {
        throw error;
    }
};

exports.deleteImage = async (imageUrl) => {
    try {
        if (!imageUrl) return;

        // Extract path from URL
        // Example URL: https://xyz.supabase.co/storage/v1/object/public/mediveda/brand/filename.jpg
        const path = imageUrl?.split(`${BUCKET_NAME}/`).pop();

        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .remove([path]);

        if (error) {
            throw new Error(`Supabase Delete Error: ${error.message}`);
        }

        return data;
    } catch (error) {
        throw error;
    }
};

exports.deleteFolder = async (folderPath) => {
    try {
        // List files in the folder first
        const { data: listData, error: listError } = await supabase.storage
            .from(BUCKET_NAME)
            .list(folderPath);

        if (listError) throw listError;

        if (listData && listData.length > 0) {
            const filesToRemove = listData.map(file => `${folderPath}/${file.name}`);
            const { error: removeError } = await supabase.storage
                .from(BUCKET_NAME)
                .remove(filesToRemove);

            if (removeError) throw removeError;
        }

        return true;
    } catch (error) {
        throw error;
    }
};
