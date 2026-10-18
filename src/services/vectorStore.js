const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

class VectorStore {
  constructor() {
    this.client = null;
    this.collectionName = 'dialog_context';
    this.dimension = 384;
  }

  async initialize() {
    try {
      this.client = new MilvusClient({
        address: process.env.MILVUS_ADDRESS || 'localhost:19530',
        username: process.env.MILVUS_USERNAME || '',
        password: process.env.MILVUS_PASSWORD || '',
      });

      await this.createCollection();
      console.log('Milvus VectorStore initialized successfully');
    } catch (error) {
      console.error('Error initializing VectorStore:', error);
      throw error;
    }
  }

  async createCollection() {
    try {
      const collections = await this.client.listCollections();
      if (!collections.includes(this.collectionName)) {
        await this.client.createCollection({
          collection_name: this.collectionName,
          dimension: this.dimension,
          metric_type: 'L2',
        });

        await this.client.createPartition({
          collection_name: this.collectionName,
          partition_name: 'default',
        });

        await this.client.createIndex({
          collection_name: this.collectionName,
          field_name: 'vector',
          index_type: 'HNSW',
          metric_type: 'L2',
          params: JSON.stringify({ M: 16, efConstruction: 200 }),
        });

        console.log('Milvus collection created successfully');
      }
    } catch (error) {
      console.error('Error creating collection:', error);
    }
  }

  generateVector(text) {
    const charFreq = {};
    for (let char of text) {
      charFreq[char] = (charFreq[char] || 0) + 1;
    }

    const vector = Array(this.dimension).fill(0);
    let i = 0;
    for (let [char, freq] of Object.entries(charFreq)) {
      vector[i % this.dimension] += freq * (char.charCodeAt(0) / 1000);
      i++;
    }

    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map((val) => (norm > 0 ? val / norm : 0));
  }

  async embedText(text) {
    return this.generateVector(text);
  }

  async storeDialog(sessionId, text) {
    try {
      const vector = this.generateVector(text);
      const id = `${sessionId}_${Date.now()}`;

      await this.client.insert({
        collection_name: this.collectionName,
        data: [
          {
            id: id,
            vector: vector,
            session_id: sessionId,
            text: text,
            timestamp: Date.now(),
          },
        ],
      });

      return true;
    } catch (error) {
      console.error('Error storing dialog:', error);
      return false;
    }
  }

  async searchRelevantContext(sessionId, query, limit = 3) {
    try {
      const queryVector = this.generateVector(query);

      const results = await this.client.search({
        collection_name: this.collectionName,
        vectors: [queryVector],
        limit: limit,
        filter: `session_id == "${sessionId}"`,
        output_fields: ['text', 'timestamp'],
      });

      if (!results || !results.results || !results.results[0] || !results.results[0].hits) {
        return [];
      }

      return results.results[0].hits
        .filter((hit) => hit && hit.entity && hit.entity.text)
        .map((hit) => ({
          text: hit.entity.text,
          distance: hit.score,
          timestamp: hit.entity.timestamp || Date.now(),
        }));
    } catch (error) {
      console.error('Error searching context:', error);
      return [];
    }
  }

  async clearSessionData(sessionId) {
    try {
      await this.client.delete({
        collection_name: this.collectionName,
        filter: `session_id == "${sessionId}"`,
      });
      return true;
    } catch (error) {
      console.error('Error clearing session data:', error);
      return false;
    }
  }

  async close() {
    console.log('Milvus client closed');
  }
}

module.exports = VectorStore;
