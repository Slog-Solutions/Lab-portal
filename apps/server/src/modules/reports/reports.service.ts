import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

export interface AttemptReportFilter {
  studentId?: string;
  exerciseId?: string;
  status?: string;
}

interface ReportRow {
  student: string;
  serviceNumber: string;
  exercise: string;
  type: string;
  rawScore: number | null;
  maxScore: number | null;
  percentage: string;
  status: string;
  startedAt: string;
  submittedAt: string;
  overridden: string;
  overrideReason: string;
}

/**
 * Ser 4 "Report tool... allow teachers to view, edit and save [scores]"
 * — the export half. Air-gapped deployment rules out any CDN-hosted
 * exporter (SheetJS's own npm `xlsx` package now redirects distribution
 * to their own CDN, which is exactly the wrong shape here); exceljs and
 * pdfkit are both plain vendorable npm packages, generated server-side so
 * the browser just downloads a finished file.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async fetchRows(filter: AttemptReportFilter): Promise<ReportRow[]> {
    const attempts = await this.prisma.attempt.findMany({
      where: { studentId: filter.studentId, exerciseId: filter.exerciseId, status: filter.status },
      include: {
        exercise: { select: { title: true, type: true } },
        student: { select: { fullName: true, serviceNumber: true } },
        scoreOverride: true,
      },
      orderBy: { startedAt: 'desc' },
    });

    return attempts.map((a) => ({
      student: a.student.fullName,
      serviceNumber: a.student.serviceNumber,
      exercise: a.exercise.title,
      type: a.exercise.type,
      rawScore: a.rawScore,
      maxScore: a.maxScore,
      percentage: a.rawScore !== null && a.maxScore ? `${Math.round((a.rawScore / a.maxScore) * 100)}%` : '—',
      status: a.status,
      startedAt: a.startedAt.toISOString(),
      submittedAt: a.submittedAt?.toISOString() ?? '—',
      overridden: a.scoreOverride ? 'Yes' : 'No',
      overrideReason: a.scoreOverride?.reason ?? '',
    }));
  }

  async streamXlsx(filter: AttemptReportFilter, res: Response): Promise<void> {
    const rows = await this.fetchRows(filter);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Digital Language Lab';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Attempts');

    sheet.columns = [
      { header: 'Student', key: 'student', width: 24 },
      { header: 'Service No.', key: 'serviceNumber', width: 14 },
      { header: 'Exercise', key: 'exercise', width: 28 },
      { header: 'Type', key: 'type', width: 18 },
      { header: 'Raw Score', key: 'rawScore', width: 12 },
      { header: 'Max Score', key: 'maxScore', width: 12 },
      { header: 'Percentage', key: 'percentage', width: 12 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Started', key: 'startedAt', width: 22 },
      { header: 'Submitted', key: 'submittedAt', width: 22 },
      { header: 'Overridden', key: 'overridden', width: 12 },
      { header: 'Override Reason', key: 'overrideReason', width: 30 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(rows);

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="attempts-report.xlsx"',
    });
    await workbook.xlsx.write(res);
    res.end();
  }

  async streamPdf(filter: AttemptReportFilter, res: Response): Promise<void> {
    const rows = await this.fetchRows(filter);
    const doc = new PDFDocument({ size: 'A4', margin: 36, layout: 'landscape' });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="attempts-report.pdf"',
    });
    doc.pipe(res);

    doc.fontSize(16).text('Digital Language Lab — Attempts Report', { align: 'left' });
    doc.fontSize(9).fillColor('#555').text(`Generated ${new Date().toLocaleString()}`, { align: 'left' });
    doc.moveDown();

    const columns = [
      { key: 'student', label: 'Student', width: 90 },
      { key: 'exercise', label: 'Exercise', width: 110 },
      { key: 'type', label: 'Type', width: 90 },
      { key: 'percentage', label: 'Score', width: 50 },
      { key: 'status', label: 'Status', width: 60 },
      { key: 'submittedAt', label: 'Submitted', width: 110 },
      { key: 'overridden', label: 'Overridden', width: 60 },
    ] as const;

    const startX = doc.page.margins.left;
    let y = doc.y;
    doc.fontSize(9).fillColor('#000');
    let x = startX;
    for (const col of columns) {
      doc.text(col.label, x, y, { width: col.width, continued: false });
      x += col.width;
    }
    y += 16;
    doc.moveTo(startX, y).lineTo(x, y).strokeColor('#ccc').stroke();
    y += 4;

    for (const row of rows) {
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage({ size: 'A4', margin: 36, layout: 'landscape' });
        y = doc.page.margins.top;
      }
      x = startX;
      for (const col of columns) {
        doc.text(String((row as unknown as Record<string, unknown>)[col.key] ?? ''), x, y, { width: col.width });
        x += col.width;
      }
      y += 16;
    }

    doc.end();
  }
}
