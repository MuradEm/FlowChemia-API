import 'reflect-metadata';
import { Module, Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express, { type Response } from 'express';
import { Database } from './database.js';
import { Clock } from './clock.js';
import { SurveyScheduler } from './scheduler.js';
import { ReportController, ReportService } from './reports.js';
import { SurveyService } from './surveys.js';
import { QuestionService } from './questions.js';
import { SurveyController } from './survey-controller.js';
import { AuthService, AuthGuard } from './auth.js';
import { WorkspaceService } from './workspace.js';
import { AuthController, OrganizationController } from './controllers.js';

@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response=host.switchToHttp().getResponse<Response>();
    let status=500; let message: unknown='Internal server error';
    if (error instanceof HttpException) {status=error.getStatus(); message=error.getResponse();}
    else if (error && typeof error==='object' && 'code' in error) {
      if (error.code==='P2002') {status=409;message='Resource already exists';}
      else if (error.code==='P2025') {status=404;message='Resource not found';}
      else if (error.code==='P2003') {status=400;message='Invalid reference';}
    }
    if (error && typeof error==='object' && 'type' in error) {
      if (error.type==='entity.parse.failed') {status=400;message='Invalid JSON';}
      if (error.type==='entity.too.large') {status=413;message='Request body too large';}
    }
    // Never serialize stack traces, SQL parameters, raw ORM objects or credentials.
    response.status(status).json(typeof message==='object'?message:{statusCode:status,message});
  }
}

@Module({controllers:[AuthController,OrganizationController,SurveyController,ReportController],providers:[Database,AuthService,AuthGuard,WorkspaceService,QuestionService,SurveyService,ReportService,Clock,SurveyScheduler]})
class AppModule {}

export async function createApp(logger: false | undefined = undefined) {
  const app=await NestFactory.create(AppModule,{bodyParser:false,logger});
  app.use(express.json({limit:'16kb'}));
  app.use((_req: unknown,res: Response,next: ()=>void)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    next();
  });
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  return app;
}
