import { describe, expect, it } from 'vitest'
import {
  cronDescription,
  errorMessage,
  fileUrl,
  folderName,
  formatBytes,
  kindLabel,
  plural,
  statusLabel,
  taskGroup,
  truncate
} from './utils'

describe('renderer utils', () => {
  it('cleans Electron IPC prefixes from errors', () => {
    expect(
      errorMessage(
        new Error("Error invoking remote method 'settings:save': Error: Disk is full")
      )
    ).toBe('Disk is full')
    expect(errorMessage('plain failure')).toBe('plain failure')
  })

  it('builds encoded knight-file urls', () => {
    expect(fileUrl('task_1', 'reports/Q3 brief.docx')).toBe(
      'knight-file://file/task_1/reports/Q3%20brief.docx'
    )
    expect(fileUrl('task_1', '/nested/file.png')).toBe(
      'knight-file://file/task_1/nested/file.png'
    )
  })

  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('labels task statuses and artifact kinds', () => {
    expect(statusLabel('waiting')).toBe('Waiting for you')
    expect(statusLabel('error')).toBe('Needs attention')
    expect(kindLabel('spreadsheet')).toBe('Spreadsheet')
    expect(kindLabel('pdf')).toBe('PDF')
  })

  it('describes known presets and adjusted fixed times without hiding custom intervals', () => {
    expect(cronDescription('0 9 * * 1-5')).toBe('Weekdays at 09:00')
    expect(cronDescription('15 6 * * *')).toBe('Every day at 06:15')
    expect(cronDescription('*/15 6 * * *')).toBe('Custom schedule')
  })

  it('groups tasks by recency', () => {
    expect(taskGroup(new Date().toISOString())).toBe('Today')
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    expect(taskGroup(twoDaysAgo)).toBe('Previous 7 days')
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    expect(taskGroup(tenDaysAgo)).toBe('Older')
  })

  it('extracts folder names from Windows and POSIX paths', () => {
    expect(folderName('C:\\Users\\Ada\\Projects\\brief')).toBe('brief')
    expect(folderName('/home/ada/projects/brief/')).toBe('brief')
  })

  it('truncates and pluralises', () => {
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(truncate('abc', 4)).toBe('abc')
    expect(plural(1, 'file')).toBe('1 file')
    expect(plural(3, 'file')).toBe('3 files')
    expect(plural(2, 'entry', 'entries')).toBe('2 entries')
  })
})
