document.addEventListener('DOMContentLoaded', () => {
    // --- ĐÃ THAY ĐỔI: Thêm địa chỉ backend của bạn ---
    const BACKEND_URL = 'https://rag-9m9s.onrender.com';

    const loadNewsBtn = document.getElementById('load-news-btn');
    const processArticlesBtn = document.getElementById('process-articles-btn');
    const ragSection = document.getElementById('rag-section');
    const newsContent = document.getElementById('news-content');
    const statusText = document.getElementById('status-text');

    const ragQuestionInput = document.getElementById('rag-question-input');
    const ragQuestionSubmit = document.getElementById('rag-question-submit');
    const ragResponseContainer = document.getElementById('rag-response-container');

    let articlesCache = [];

    // --- Hàm hiển thị giao diện ---
    function updateStatus(message, showLoader = false) {
        statusText.innerHTML = `${message} ${showLoader ? '<div class="loader inline-block ml-2"></div>' : ''}`;
    }

    function renderArticles(articles) {
        if (!articles || articles.length === 0) {
            newsContent.innerHTML = '<p class="col-span-full text-center text-gray-500">Chưa có tin tức nào.</p>';
            return;
        }
        newsContent.innerHTML = articles.map(article => `
            <div class="article-card bg-white rounded-lg shadow-sm overflow-hidden flex flex-col p-4 border border-gray-200">
                <h3 class="font-bold text-lg text-gray-900 mb-2">${article.title}</h3>
                <p class="text-gray-600 text-sm mb-3 flex-grow">${article.description}</p>
                <div class="flex items-center justify-between text-xs text-gray-500 mt-auto pt-2">
                    <a href="${article.link}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline">Đọc bài gốc</a>
                    <span>${new Date(article.pubDate).toLocaleDateString('vi-VN')}</span>
                </div>
            </div>
        `).join('');
    }
    
    function renderRagResponse(data) {
        if (!data) {
             ragResponseContainer.innerHTML = '<p class="text-red-500">Có lỗi xảy ra, không nhận được phản hồi.</p>';
             return;
        }
        
        let sourcesHTML = '';
        if (data.sources && data.sources.length > 0) {
            sourcesHTML = `
                <div class="mt-4 p-3 bg-gray-50 rounded-lg">
                     <h4 class="text-sm font-bold text-gray-600 mb-2">Các nguồn được AI sử dụng:</h4>
                     <ul class="list-disc list-inside space-y-1 text-xs">
                        ${[...new Set(data.sources.map(s => s.metadata.url))].map(url => {
                            const source = data.sources.find(s => s.metadata.url === url);
                            return `<li><a href="${source.metadata.url}" target="_blank" class="text-indigo-600 hover:underline">${source.metadata.title}</a></li>`
                        }).join('')}
                     </ul>
                </div>
            `;
        }

        ragResponseContainer.innerHTML = `
            <div class="p-4 bg-white rounded-lg border">
                <p class="text-gray-800 whitespace-pre-wrap">${data.answer}<span class="blinking-cursor">▍</span></p>
                ${sourcesHTML}
            </div>
        `;
        // Remove blinking cursor when done
        setTimeout(() => {
           const cursor = ragResponseContainer.querySelector('.blinking-cursor');
           if (cursor) cursor.remove();
        }, 500);
    }

    // --- Hàm gọi API ---
    loadNewsBtn.addEventListener('click', async () => {
        updateStatus('Đang tải tin tức từ máy chủ...', true);
        loadNewsBtn.disabled = true;
        try {
            // --- ĐÃ THAY ĐỔI: Gọi đến API backend của bạn ---
            const response = await fetch(`${BACKEND_URL}/api/news`);
            if (!response.ok) throw new Error(`Lỗi từ máy chủ: ${response.statusText}`);
            
            articlesCache = await response.json();
            renderArticles(articlesCache);
            updateStatus(`Đã tải thành công ${articlesCache.length} tin. Sẵn sàng để xử lý.`);
            processArticlesBtn.disabled = false;
        } catch (error) {
            updateStatus(`Lỗi khi tải tin: ${error.message}`);
        } finally {
            loadNewsBtn.disabled = false;
        }
    });

    processArticlesBtn.addEventListener('click', async () => {
        if (articlesCache.length === 0) {
            updateStatus('Vui lòng tải tin tức trước.');
            return;
        }
        updateStatus('Gửi yêu cầu xử lý và nhúng vector đến máy chủ... (Quá trình này có thể mất vài phút)', true);
        processArticlesBtn.disabled = true;
        loadNewsBtn.disabled = true;

        try {
            // --- ĐÃ THAY ĐỔI: Gọi đến API backend của bạn ---
            const response = await fetch(`${BACKEND_URL}/api/process-articles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articles: articlesCache })
            });
            if (!response.ok) throw new Error(`Lỗi từ máy chủ: ${response.statusText}`);

            const result = await response.json();
            updateStatus(result.message);
            ragSection.classList.remove('hidden');

        } catch (error) {
            updateStatus(`Lỗi khi xử lý bài báo: ${error.message}`);
        } finally {
            processArticlesBtn.disabled = true; // Chỉ cho xử lý 1 lần
             loadNewsBtn.disabled = false;
        }
    });
    
    ragQuestionSubmit.addEventListener('click', async () => {
        const query = ragQuestionInput.value.trim();
        if (!query) return;
        
        ragResponseContainer.innerHTML = '<div class="loader mx-auto"></div>';
        ragQuestionInput.value = '';
        
        try {
            // --- ĐÃ THAY ĐỔI: Gọi đến API backend của bạn ---
            const response = await fetch(`${BACKEND_URL}/api/rag-query`, {
                 method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });
            if (!response.ok) throw new Error(`Lỗi từ máy chủ: ${response.statusText}`);
            
            const data = await response.json();
            renderRagResponse(data);
            
        } catch (error) {
            ragResponseContainer.innerHTML = `<p class="text-red-500">Lỗi: ${error.message}</p>`;
        }
    });
    
    ragQuestionInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            ragQuestionSubmit.click();
        }
    });

});
