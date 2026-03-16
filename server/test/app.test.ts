import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { ZodError } from 'zod';

import { createApp } from '../src/app.js';

describe('App Error Handling', () => {
  let app: express.Express;
  let errorHandler: express.ErrorRequestHandler;

  beforeAll(() => {
    // We can spy on express().use to capture the error handler when it's registered
    const originalUse = express.application.use;
    vi.spyOn(express.application, 'use').mockImplementation(function (this: any, ...args: any[]) {
      // Look for a function with 4 arguments (error handler signature)
      for (const arg of args) {
        if (typeof arg === 'function' && arg.length === 4) {
          errorHandler = arg as express.ErrorRequestHandler;
        }
      }
      return originalUse.apply(this, args);
    });

    app = createApp();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('handles ZodError correctly', () => {
    expect(errorHandler).toBeDefined();

    const error = new ZodError([{ code: 'custom', message: 'Test error', path: ['test'] }]);
    const mockRequest = {} as express.Request;
    const mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    } as unknown as express.Response;
    const mockNext = vi.fn() as express.NextFunction;

    errorHandler(error, mockRequest, mockResponse, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      message: 'Validation error',
      errors: error.errors
    });
  });

  it('handles unexpected errors generically', () => {
    expect(errorHandler).toBeDefined();

    const error = new Error('Secret internal error that should not be exposed');
    const mockRequest = {} as express.Request;
    const mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    } as unknown as express.Response;
    const mockNext = vi.fn() as express.NextFunction;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    errorHandler(error, mockRequest, mockResponse, mockNext);

    expect(consoleSpy).toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      message: 'Unexpected server error'
    });
  });
});
