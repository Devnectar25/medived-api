const supabase = require('../config/supabaseClient');

const BUCKET_NAME = 'mediveda';

exports.uploadImage = async (file, folder = 'brand') => {
    try {
        const timestamp = Date.now();
        const fileExt = file.originalname.split('.').pop();
        const fileName = `${folder}/${timestamp}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(fileName, file.buffer, {
                contentType: file.mimetype,
                upsert: false
            });

        if (error) {
            throw new Error(`Supabase Upload Error: ${error.message}`);
        }

        const { data: publicUrlData } = supabase.storage
            .from(BUCKET_NAME)
            .getPublicUrl(fileName);

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
        const path = imageUrl.split(`${BUCKET_NAME}/`).pop();

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
