import { getPullRequestFiles } from '../services/githubService.js';
import {
  getRecentReviews,
  getReviewForPullRequest
} from '../services/reviewService.js';

export const typeDefs = `#graphql
  type PullRequestFile {
    filename: String!
    status: String!
    additions: Int!
    deletions: Int!
    changes: Int!
    patch: String
  }

  type ReviewIssue {
    id: ID!
    category: String!
    type: String!
    severity: String!
    file: String
    message: String!
    suggestion: String
    sample: String
    codeSnippet: String
    fixCode: String
    aiExplanation: String
    aiFixSuggestion: String
    aiFixCode: String
    aiSuggestedTests: String
  }

  type ReviewSummary {
    totalIssues: Int!
    severityDistribution: SeverityDistribution!
    filesAffected: [String!]!
    riskScore: Int!
  }

  type SeverityDistribution {
    HIGH: Int!
    MEDIUM: Int!
    LOW: Int!
  }

  type PullRequestReview {
    id: ID!
    owner: String!
    repo: String!
    number: Int!
    status: String!
    createdAt: String!
    updatedAt: String!
    files: [PullRequestFile!]!
    issues: [ReviewIssue!]!
    summary: ReviewSummary!
    githubReviewStatus: String
    githubReviewUrl: String
  }

  type Query {
    health: String!
    pullRequestFiles(owner: String!, repo: String!, number: Int!): [PullRequestFile!]!
    pullRequestReview(owner: String!, repo: String!, number: Int!): PullRequestReview
    recentReviews(limit: Int): [PullRequestReview!]!
  }
`;

export const resolvers = {
  Query: {
    health: () => 'ok',
    pullRequestFiles: async (_parent, args) => {
      const { owner, repo, number } = args;
      const files = await getPullRequestFiles({
        owner,
        repo,
        pullNumber: number
      });
      return files;
    },
    pullRequestReview: async (_parent, args) => {
      const { owner, repo, number } = args;
      return await getReviewForPullRequest({
        owner,
        repo,
        pullNumber: number
      });
    },
    recentReviews: async (_parent, args) => {
      const limit = args.limit ?? 20;
      return await getRecentReviews(limit);
    }
  }
};

