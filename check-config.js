const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    // Get SAP configuration
    const sapConfig = await prisma.wP_CONFIGURATION.findFirst({
      where: {
        Type: 'SAP',
        IsActive: true
      },
      orderBy: {
        CreateTS: 'desc'
      }
    });

    console.log('SAP Configuration:');
    console.log('ID:', sapConfig?.ID);
    console.log('Type:', sapConfig?.Type);
    console.log('IsActive:', sapConfig?.IsActive);
    console.log('CreateTS:', sapConfig?.CreateTS);
    
    // Parse settings if it's a string
    let settings = sapConfig?.Settings;
    if (typeof settings === 'string') {
      try {
        settings = JSON.parse(settings);
      } catch (error) {
        console.error('Error parsing settings:', error);
      }
    }
    
    console.log('Settings:', settings);
    console.log('Network Path:', settings?.networkPath);
    
    // Get all files in the directory
    const fs = require('fs');
    const path = require('path');
    const moment = require('moment');
    
    const networkPath = settings?.networkPath;
    const type = 'Schedule';
    const company = 'SKPBM Branch';
    const date = '2025-05-21';
    
    const directoryPath = path.join(networkPath, type, company, date);
    console.log('Directory Path:', directoryPath);
    
    if (fs.existsSync(directoryPath)) {
      console.log('Directory exists');
      const files = fs.readdirSync(directoryPath);
      console.log(`Found ${files.length} files`);
      
      // Print first 5 files
      console.log('Sample files:');
      for (let i = 0; i < Math.min(5, files.length); i++) {
        console.log(`- ${files[i]}`);
      }
      
      // Check for files with "INV" in the name
      const invFiles = files.filter(file => file.includes('INV'));
      console.log(`Found ${invFiles.length} files with "INV" in the name`);
      if (invFiles.length > 0) {
        console.log('Sample INV files:');
        for (let i = 0; i < Math.min(5, invFiles.length); i++) {
          console.log(`- ${invFiles[i]}`);
        }
      }
    } else {
      console.log('Directory does not exist');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
