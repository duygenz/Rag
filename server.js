import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// --- KHỞI TẠO ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Phục vụ các file trong thư mục public

// --- KẾT NỐI GOOGLE & SUPABASE ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const generativeModel = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
});

// --- CÁC HÀM TIỆN ÍCH ---

// Hàm cào dữ liệu từ một URL
async function scrapeContent(url) {
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        // Cố gắng tìm các thẻ chứa nội dung chính
        $('script, style, nav, footer, header, aside').remove();
        return $('body').text().replace(/\s\s+/g, ' ').trim();
    } catch (error) {
        console.error(`Error scraping ${url}:`, error.message);
        return null;
    }
}

// Hàm chia nhỏ văn bản
function chunkText(text, chunkSize = 800, chunkOverlap = 100) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.substring(i, i + chunkSize));
        i += chunkSize - chunkOverlap;
    }
    return chunks;
}


// --- API ENDPOINTS ---

/**
 * Endpoint lấy tin tức từ CafeF
 * Nhận tin, cào nội dung và phân tích cảm xúc ban đầu
 */
app.get('/api/news', async (req, res) => {
    console.log("Fetching news from CafeF API...");
    try {
        const apiResponse = await axios.get('https://cafef-api-2hna.onrender.com/api/news?limit=20');
        const articles = apiResponse.data
            .filter(item => item && item.title && item.link)
            .map(item => ({
                title: item.title,
                link: `https://cafef.vn${item.link}`,
                description: item.description.split('/>').pop().trim(),
                pubDate: item.pubDate,
            }));

        res.json(articles);
    } catch (error) {
        console.error('Error fetching news:', error);
        res.status(500).json({ message: 'Failed to fetch news' });
    }
});

/**
 * Endpoint xử lý và tạo embedding cho các bài báo
 * Đây là bước "làm giàu" dữ liệu, biến văn bản thành vector
 */
app.post('/api/process-articles', async (req, res) => {
    const articles = req.body.articles;
    if (!articles || !Array.isArray(articles)) {
        return res.status(400).json({ message: "Invalid articles data" });
    }
    console.log(`Processing ${articles.length} articles...`);

    try {
        for (const article of articles) {
            console.log(`Scraping and chunking: ${article.title}`);
            const content = await scrapeContent(article.link);
            if (!content || content.length < 200) continue;

            const chunks = chunkText(content);
            console.log(`Generated ${chunks.length} chunks. Creating embeddings...`);

            // Tạo embeddings cho các chunks
            const embeddingResponse = await embeddingModel.batchEmbedContents({
                requests: chunks.map(chunk => ({ content: chunk })),
            });
            const embeddings = embeddingResponse.embeddings.map(e => e.values);

            const documentsToInsert = chunks.map((chunk, i) => ({
                content: chunk,
                embedding: embeddings[i],
                metadata: {
                    url: article.link,
                    title: article.title
                }
            }));
            
            // Lưu vào Supabase
            await supabase.from('documents').insert(documentsToInsert);
        }

        res.json({ message: "Successfully processed and embedded articles." });
    } catch (error) {
        console.error('Error in processing articles:', error);
        res.status(500).json({ message: 'Failed to process articles' });
    }
});


/**
 * Endpoint chính cho RAG
 * Nhận câu hỏi, tìm kiếm thông tin và trả về câu trả lời từ AI
 */
app.post('/api/rag-query', async (req, res) => {
    const { query } = req.body;
    if (!query) {
        return res.status(400).json({ message: "Query is required" });
    }
    console.log(`Received RAG query: ${query}`);

    try {
        // 1. Tạo embedding cho câu hỏi
        const queryEmbeddingResponse = await embeddingModel.embedContent(query);
        const queryEmbedding = queryEmbeddingResponse.embedding.values;

        // 2. Dùng embedding để tìm các documents liên quan trong Supabase
        const { data: documents, error } = await supabase.rpc('match_documents', {
            query_embedding: queryEmbedding,
            match_threshold: 0.75, // Ngưỡng tương đồng
            match_count: 5 // Lấy 5 kết quả tốt nhất
        });

        if (error) throw error;
        if (!documents || documents.length === 0) {
            return res.json({ answer: "Xin lỗi, tôi không tìm thấy thông tin nào liên quan trong cơ sở dữ liệu tin tức để trả lời câu hỏi này." });
        }
        
        console.log(`Found ${documents.length} relevant documents.`);

        // 3. Xây dựng prompt với ngữ cảnh đã tìm được
        const context = documents.map(doc => `- Nguồn: ${doc.metadata.title} (${doc.metadata.url})\n- Nội dung: ${doc.content}`).join('\n\n---\n\n');
        const finalPrompt = `
            Bạn là một trợ lý phân tích đầu tư chuyên nghiệp. Dựa HOÀN TOÀN vào ngữ cảnh được cung cấp dưới đây để trả lời câu hỏi của người dùng một cách súc tích, chính xác.
            Không bịa đặt thông tin không có trong ngữ cảnh.
            
            NGỮ CẢNH:
            """
            ${context}
            """

            CÂU HỎI CỦA NGƯỜI DÙNG: "${query}"

            CÂU TRẢ LỜI CỦA BẠN:
        `;

        // 4. Gọi Gemini để tạo câu trả lời
        const result = await generativeModel.generateContent(finalPrompt);
        const response = await result.response;
        
        res.json({ answer: response.text(), sources: documents });

    } catch (error) {
        console.error('Error in RAG query:', error.message);
        res.status(500).json({ message: 'Failed during RAG process' });
    }
});


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
