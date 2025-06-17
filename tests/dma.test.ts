import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import { findDmaAssignments } from '../src/dma'
import { walk } from '../src/util'
import type { target_t } from '../src/types'

// Load sample targets for testing
let targets: target_t[] = []

beforeAll(async () => {
  // Load a few representative targets for testing
  const sampleTargets = [
    'targets/spbe-speedybeef405aio.yaml',
    'targets/cust-nfe_breadboard.yaml', 
    'targets/zeez-zeezwhoop.yaml',
    'targets/befh-betafpvg473.yaml'
  ]
  
  for (const targetPath of sampleTargets) {
    const content = await fs.promises.readFile(targetPath, 'utf8')
    const target = YAML.parse(content)
    targets.push(target)
  }
})

describe('Simplified SAT-based DMA Assignment System', () => {
  describe('Target Validation', () => {
    it('should enforce exactly 4 motors requirement', async () => {
      // Test with invalid motor counts
      const invalidTargets = [
        { name: 'test1', mcu: 'stm32f405', motor_pins: ['PA1', 'PA2', 'PA3'] }, // 3 motors
        { name: 'test2', mcu: 'stm32f405', motor_pins: ['PA1', 'PA2', 'PA3', 'PA4', 'PA5'] }, // 5 motors
        { name: 'test3', mcu: 'stm32f405', motor_pins: [] }, // 0 motors
        { name: 'test4', mcu: 'stm32f405' }, // no motor_pins property
      ]
      
      for (const target of invalidTargets) {
        await expect(findDmaAssignments(target as any)).rejects.toThrow(/must have exactly 4 motors/)
      }
    })
    
    it('should accept targets with exactly 4 motors', async () => {
      // All our test targets should have 4 motors and work
      for (const target of targets) {
        expect(target.motor_pins).toBeDefined()
        expect(target.motor_pins?.length).toBe(4)
        
        // Should not throw
        const result = await findDmaAssignments(target)
        expect(result.dma).toBeDefined()
      }
    })
  })

  describe('Core Constraints', () => {
    it('should assign ALL SPI ports for each target', async () => {
      for (const target of targets) {
        const result = await findDmaAssignments(target)
        
        // Count expected SPI assignments
        const expectedSpiAssignments = (target.spi_ports || []).length * 2 // RX + TX
        
        // Count actual SPI assignments
        const actualSpiAssignments = Object.keys(result.dma || {})
          .filter(key => key.startsWith('SPI')).length
        
        expect(actualSpiAssignments).toBe(expectedSpiAssignments)
      }
    })
    
    it('should ensure DSHOT works for all targets with motors', async () => {
      for (const target of targets) {
        const result = await findDmaAssignments(target)
        
        if (target.motor_pins && target.motor_pins.length > 0) {
          // Should have at least one DSHOT assignment
          const dshotAssignments = Object.keys(result.dma || {})
            .filter(key => key.startsWith('DSHOT'))
          
          expect(dshotAssignments.length).toBeGreaterThan(0)
          
          // Should have a mode selected
          expect((result as any)._dshotMode?.mode).toBeDefined()
          expect(['DMAR', 'CCR', 'BB']).toContain((result as any)._dshotMode.mode)
        }
      }
    })
  })

  describe('DSHOT Mode Hierarchy', () => {
    it('should try DMAR first for targets with all motors on same timer', async () => {
      const nfeBreadboard = targets.find(t => t.name === 'nfe_breadboard')
      if (nfeBreadboard) {
        const result = await findDmaAssignments(nfeBreadboard)
        
        // This target should be able to use DMAR mode
        expect((result as any)._dshotMode?.mode).toBe('DMAR')
        expect(result.dma?.DSHOT_DMAR).toBeDefined()
      }
    })
    
    it('should fall back to other modes when DMAR not possible', async () => {
      const zeezWhoop = targets.find(t => t.name === 'zeezwhoop')
      if (zeezWhoop) {
        const result = await findDmaAssignments(zeezWhoop)
        
        // This target should get some DSHOT mode
        expect(['DMAR', 'CCR', 'BB']).toContain((result as any)._dshotMode?.mode)
        
        // Should have working motor assignments
        const dshotKeys = Object.keys(result.dma || {}).filter(k => k.startsWith('DSHOT'))
        expect(dshotKeys.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Architecture Support', () => {
    it('should handle fixed architecture (STM32F4/F7)', async () => {
      const f4Target = targets.find(t => t.mcu.toLowerCase().startsWith('stm32f4'))
      if (f4Target) {
        const result = await findDmaAssignments(f4Target)
        
        // Should generate valid assignments
        expect(result.dma).toBeDefined()
        expect(Object.keys(result.dma).length).toBeGreaterThan(0)
        
        // Fixed architecture assignments should have channel numbers
        for (const assignment of Object.values(result.dma as any)) {
          if (assignment.dma?.startsWith('DMA')) {
            expect(assignment.channel).toBeDefined()
          }
        }
      }
    })
    
    it('should handle flexible architecture (STM32G4/H7)', async () => {
      const g4Target = targets.find(t => t.mcu.toLowerCase().startsWith('stm32g4'))
      if (g4Target) {
        const result = await findDmaAssignments(g4Target)
        
        // Should generate valid assignments
        expect(result.dma).toBeDefined()
        expect(Object.keys(result.dma).length).toBeGreaterThan(0)
        
        // Flexible architecture assignments should have request numbers
        for (const assignment of Object.values(result.dma as any)) {
          if (assignment.dma?.startsWith('DMA')) {
            expect(assignment.request).toBeDefined()
          }
        }
      }
    })
  })

  describe('Header Generation', () => {
    it('should generate comprehensive headers for all targets', async () => {
      for (const target of targets) {
        const result = await findDmaAssignments(target)
        
        // Should have header
        expect((result as any)._dmaHeader).toBeDefined()
        expect(typeof (result as any)._dmaHeader).toBe('string')
        expect((result as any)._dmaHeader.length).toBeGreaterThan(100)
        
        // Header should contain key information
        expect((result as any)._dmaHeader).toContain(target.name)
        expect((result as any)._dmaHeader).toContain(target.mcu)
        expect((result as any)._dmaHeader).toContain('DMA Assignment Summary')
      }
    })
  })

  describe('Performance and Coverage', () => {
    it('should process all test targets successfully', async () => {
      let successCount = 0
      let errorCount = 0
      
      for (const target of targets) {
        try {
          const result = await findDmaAssignments(target)
          expect(result.dma).toBeDefined()
          successCount++
        } catch (error) {
          console.error(`Failed to process ${target.name}:`, error)
          errorCount++
        }
      }
      
      // All test targets should succeed
      expect(successCount).toBe(targets.length)
      expect(errorCount).toBe(0)
    })
    
    it('should maintain consistency across multiple runs', async () => {
      const target = targets[0]
      
      // Run assignment multiple times
      const results = []
      for (let i = 0; i < 3; i++) {
        const result = await findDmaAssignments(target)
        results.push(result)
      }
      
      // Results should be identical
      for (let i = 1; i < results.length; i++) {
        expect(JSON.stringify(results[i].dma)).toBe(JSON.stringify(results[0].dma))
        expect((results[i] as any)._dshotMode?.mode).toBe((results[0] as any)._dshotMode?.mode)
      }
    })
  })

  describe('Real World Validation', () => {
    it('should handle speedybeef405aio correctly', async () => {
      const speedybee = targets.find(t => t.name === 'speedybeef405aio')
      if (speedybee) {
        const result = await findDmaAssignments(speedybee)
        
        // Should have SPI assignments for all 3 SPI ports
        expect(result.dma?.SPI1_RX).toBeDefined()
        expect(result.dma?.SPI1_TX).toBeDefined()
        expect(result.dma?.SPI2_RX).toBeDefined()
        expect(result.dma?.SPI2_TX).toBeDefined()
        expect(result.dma?.SPI3_RX).toBeDefined()
        expect(result.dma?.SPI3_TX).toBeDefined()
        
        // Should have working DSHOT
        const dshotMode = (result as any)._dshotMode?.mode
        expect(['DMAR', 'CCR', 'BB']).toContain(dshotMode)
      }
    })
    
    it('should handle G473 flexible architecture correctly', async () => {
      const g473 = targets.find(t => t.name === 'betafpvg473')
      if (g473) {
        const result = await findDmaAssignments(g473)
        
        // Should have all SPI assignments
        expect(result.dma?.SPI1_RX).toBeDefined()
        expect(result.dma?.SPI1_TX).toBeDefined()
        expect(result.dma?.SPI2_RX).toBeDefined() 
        expect(result.dma?.SPI2_TX).toBeDefined()
        expect(result.dma?.SPI3_RX).toBeDefined()
        expect(result.dma?.SPI3_TX).toBeDefined()
        
        // Flexible architecture should use request numbers
        for (const assignment of Object.values(result.dma as any)) {
          expect(assignment.request).toBeDefined()
          expect(typeof assignment.request).toBe('number')
        }
      }
    })
  })
})