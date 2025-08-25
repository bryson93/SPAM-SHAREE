const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const total = new Map();
const activeTimers = new Map(); // Store active timers for stopping functionality
const ACCESS_KEY = "stop share"; // Password for stopping shares

app.get('/total', (req, res) => {
  const data = Array.from(total.values()).map((link, index)  => ({
    session: index + 1,
    url: link.url,
    count: link.count,
    id: link.id,
    target: link.target,
  }));
  res.json(JSON.parse(JSON.stringify(data || [], null, 2)));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// New endpoint to view post content by Post ID
app.get('/view-post-by-id', async (req, res) => {
  const { postId } = req.query;
  
  if (!postId) {
    return res.status(400).json({
      error: 'Post ID parameter is required'
    });
  }
  
  try {
    // Construct Facebook URL from post ID
    const facebookUrl = `https://www.facebook.com/${postId}`;
    const postContent = await getPostContent(facebookUrl);
    res.status(200).json({
      status: 200,
      content: postContent,
      url: facebookUrl
    });
  } catch (err) {
    return res.status(500).json({
      status: 500,
      error: err.message || err
    });
  }
});

// New endpoint to stop active shares
app.post('/stop-share', async (req, res) => {
  const { accessKey, postId } = req.body;
  
  if (!accessKey || !postId) {
    return res.status(400).json({
      error: 'Access key and post ID are required'
    });
  }
  
  if (accessKey !== ACCESS_KEY) {
    return res.status(401).json({
      error: 'Invalid access key'
    });
  }
  
  try {
    const result = stopShare(postId);
    if (result) {
      res.status(200).json({
        status: 200,
        message: `Share for post ${postId} stopped successfully`
      });
    } else {
      res.status(404).json({
        status: 404,
        error: `No active share found for post ${postId}`
      });
    }
  } catch (err) {
    return res.status(500).json({
      status: 500,
      error: err.message || err
    });
  }
});

app.post('/api/submit', async (req, res) => {
  const {
    cookie,
    url,
    amount,
    interval,
  } = req.body;
  
  if (!cookie || !url || !amount || !interval) return res.status(400).json({
    error: 'Missing state, url, amount, or interval'
  });
  
  try {
    const cookies = await convertCookie(cookie);
    if (!cookies) {
      return res.status(400).json({
        status: 500,
        error: 'Invalid cookies'
      });
    };
    
    await share(cookies, url, amount, interval)
    res.status(200).json({
      status: 200
    });
  } catch (err) {
    return res.status(500).json({
      status: 500,
      error: err.message || err
    });
  }
});

// Function to stop a share by post ID
function stopShare(postId) {
  if (activeTimers.has(postId)) {
    clearInterval(activeTimers.get(postId).timer);
    clearTimeout(activeTimers.get(postId).timeout);
    activeTimers.delete(postId);
    
    if (total.has(postId)) {
      total.delete(postId);
    }
    
    return true;
  }
  return false;
}

async function share(cookies, url, amount, interval) {
  const id = await getPostID(url);
  const accessToken = await getAccessToken(cookies);
  
  if (!id) {
    throw new Error("Unable to get link id: invalid URL, it's either a private post or visible to friends only");
  }
  
  const postId = total.has(id) ? id + 1 : id;
  total.set(postId, {
    url,
    id,
    count: 0,
    target: amount,
  });
  
  const headers = {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate',
    'connection': 'keep-alive',
    'content-length': '0',
    'cookie': cookies,
    'host': 'graph.facebook.com'
  };
  
  let sharedCount = 0;
  let timer;
  let timeout;
  
  async function sharePost() {
    try {
      const response = await axios.post(`https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`, {}, {
        headers
      });
      
      if (response.status !== 200) {
        console.error('Share failed:', response.status);
      } else {
        total.set(postId, {
          ...total.get(postId),
          count: total.get(postId).count + 1,
        });
        sharedCount++;
      }
      
      if (sharedCount === amount) {
        clearInterval(timer);
        clearTimeout(timeout);
        activeTimers.delete(postId);
      }
    } catch (error) {
      console.error('Error sharing post:', error.message);
      clearInterval(timer);
      clearTimeout(timeout);
      activeTimers.delete(postId);
      total.delete(postId);
    }
  }
  
  timer = setInterval(sharePost, interval * 1000);
  timeout = setTimeout(() => {
    clearInterval(timer);
    activeTimers.delete(postId);
    total.delete(postId);
  }, amount * interval * 1000);
  
  // Store the timer references for potential stopping
  activeTimers.set(postId, {
    timer,
    timeout
  });
}

async function getPostID(url) {
  try {
    const response = await axios.post('https://id.traodoisub.com/api.php', `link=${encodeURIComponent(url)}`, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data.id;
  } catch (error) {
    return;
  }
}

async function getAccessToken(cookie) {
  try {
    const headers = {
      'authority': 'business.facebook.com',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      'accept-language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
      'cache-control': 'max-age=0',
      'cookie': cookie,
      'referer': 'https://www.facebook.com/',
      'sec-ch-ua': '".Not/A)Brand";v="99", "Google Chrome";v="103", "Chromium";v="103"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Linux"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    };
    
    const response = await axios.get('https://business.facebook.com/content_management', {
      headers
    });
    
    const token = response.data.match(/"accessToken":\s*"([^"]+)"/);
    if (token && token[1]) {
      const accessToken = token[1];
      return accessToken;
    }
  } catch (error) {
    return;
  }
}

async function convertCookie(cookie) {
  return new Promise((resolve, reject) => {
    try {
      const cookies = JSON.parse(cookie);
      const sbCookie = cookies.find(cookies => cookies.key === "sb");
      if (!sbCookie) {
        reject("Detect invalid appstate please provide a valid appstate");
      }
      const sbValue = sbCookie.value;
      const data = `sb=${sbValue}; ${cookies.slice(1).map(cookies => `${cookies.key}=${cookies.value}`).join('; ')}`;
      resolve(data);
    } catch (error) {
      reject("Error processing appstate please provide a valid appstate");
    }
  });
}

// Function to get post content (simplified implementation)
async function getPostContent(url) {
  try {
    // This is a simplified implementation
    // In a real scenario, you would need to properly scrape the Facebook post content
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Extract content from the page (this is a simplified example)
    // In reality, Facebook's structure is complex and may require a dedicated parser
    const contentMatch = response.data.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
    
    if (contentMatch && contentMatch[1]) {
      return contentMatch[1];
    } else {
      return "Unable to extract post content. The post might be private or require login.";
    }
  } catch (error) {
    throw new Error("Failed to retrieve post content: " + error.message);
  }
}

app.listen(5000, () => {
  console.log('Server running on port 5000');
});