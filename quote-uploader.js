addEventListener("fetch", event => {
    event.respondWith(handleRequest(event.request));
});

// Main function to handle the request
async function handleRequest(request) {
    // Fetch the quotes data from GitHub
    const quotesData = await fetchQuotesFromGitHub();

    if (!quotesData) {
        return new Response("Failed to fetch quotes data from GitHub.", { status: 500 });
    }

    // Update quotes and images in KV
    await updateQuotesAndImagesInKV(quotesData);
    return new Response("Quotes and images updated in KV successfully.", { status: 200 });
}

// Function to fetch quotes.json dynamically from GitHub
async function fetchQuotesFromGitHub() {
    const url = 'https://api.github.com/repos/flowqi-dev/quote-uploader/contents/quotes.json';
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/vnd.github.v3.raw',
            // Uncomment the line below if your repo is private
            'Authorization': `Bearer ${GITHUB_TOKEN}`
        }
    });

    if (response.ok) {
        return await response.json();
    } else {
        console.error(`Error fetching quotes.json: ${response.status}`);
        return null;
    }
}

// Function to update authors and their quotes in KV, and handle image checking/uploading
async function updateQuotesAndImagesInKV(quotesData) {
    for (let author of quotesData.authors) {
        const authorKey = `author_${author.author_id}`; // Use author_id as the key in KV

        // Fetch the author from KV to check if they already exist
        let existingAuthor = await QUOTES_KV.get(authorKey);

        if (existingAuthor) {
            existingAuthor = JSON.parse(existingAuthor);

            // Merge quotes (without duplicating existing quotes)
            for (let quote of author.quotes) {
                if (!existingAuthor.quotes.includes(quote)) {
                    existingAuthor.quotes.push(quote);
                }
            }

            // Check if image_url exists. If not, fetch and upload the image
            if (!existingAuthor.image_url) {
                const imageUrl = await fetchAndUploadImage(author.author);
                if (imageUrl) {
                    existingAuthor.image_url = imageUrl;
                }
            }

            // Store updated quotes and image URL in KV
            await QUOTES_KV.put(authorKey, JSON.stringify(existingAuthor));
        } else {
            // If author doesn't exist, fetch and upload an image
            const imageUrl = await fetchAndUploadImage(author.author);

            // Store the new author with their quotes and image URL in KV
            const newAuthor = {
                author_id: author.author_id,
                author: author.author,
                quotes: author.quotes,
                image_url: imageUrl || null // If no image, set to null
            };
            await QUOTES_KV.put(authorKey, JSON.stringify(newAuthor));
        }
    }
}

// Function to fetch and upload the image from Google or predefined source
async function fetchAndUploadImage(authorName) {
    const imageUrl = await fetchImageFromGoogle(authorName);

    if (imageUrl) {
        const imageId = `avatar-${authorName.toLowerCase().replace(/\s+/g, '-')}`;
        const imageExists = await checkImageExistsInCloudflare(imageId);

        if (!imageExists) {
            return await uploadImageToCloudflare(imageUrl, authorName);
        } else {
            return imageExists;
        }
    }

    return null;
}

// Function to check if an image already exists in Cloudflare Images
async function checkImageExistsInCloudflare(imageId) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/images/v1/${imageId}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${CLOUDFLARE_IMAGES_API_TOKEN}`
        }
    });

    if (response.ok) {
        const imageData = await response.json();
        return imageData.result.variants[0];
    } else {
        return null;
    }
}

// Function to fetch the image URL from Google Custom Search API with face filter
async function fetchImageFromGoogle(authorName) {
    const apiKey = GOOGLE_API_KEY;
    const cx = CUSTOM_SEARCH_ENGINE_ID;

    const searchUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(authorName)}+portrait+headshot&searchType=image&imgType=photo&imgSize=large&fileType=jpg&num=1&key=${apiKey}&cx=${cx}`;

    const response = await fetch(searchUrl);
    const searchResults = await response.json();

    if (searchResults.items && searchResults.items.length > 0) {
        return searchResults.items[0].link;
    } else {
        return null;
    }
}

// Function to upload the image to Cloudflare Images
async function uploadImageToCloudflare(imageUrl, authorName) {
    const imageResponse = await fetch(imageUrl);
    const imageData = await imageResponse.blob();

    const formData = new FormData();
    formData.append('file', imageData, `${authorName}.jpg`);
    formData.append('id', `avatar-${authorName.toLowerCase().replace(/\s+/g, '-')}`);

    const uploadResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/images/v1`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CLOUDFLARE_IMAGES_API_TOKEN}`
        },
        body: formData
    });

    const uploadResult = await uploadResponse.json();

    if (uploadResponse.ok) {
        return uploadResult.result.variants[0];
    } else {
        throw new Error(uploadResult.errors);
    }
}
