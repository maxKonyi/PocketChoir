import React, { useRef, useEffect } from 'react';
import { ParsedNote } from './MidiUploader';
import { noteNameToSemitone, getChromaticDegreeLabel, pitchToLineIndex, getNonDiatonicDegrees } from '../utils/musicUtils';
import { easeCubicOut } from 'd3-ease'; // This provides smooth animations that start fast and slow down gradually

interface VisualizerCanvasProps {
  notes: ParsedNote[];            // The musical notes to display
  fontSize: number;               // Size of the text labels
  playTime: number;               // Current playback position in seconds
  setPlayTime: (time: number) => void;  // Function to update the playback position
  setZoomSec: (zoom: number) => void;   // Function to change how many seconds are visible on screen
  labelsOn?: boolean;             // Whether to show note labels
  rangeLow: number;               // Lowest note to display (MIDI number)
  rangeHigh: number;              // Highest note to display (MIDI number)
  tonic: string;                  // The root note (like 'C' for C major)
  zoomSec: number;                // How many seconds are visible on screen
  width?: number;                 // Width of the canvas
  height?: number;                // Height of the canvas
  curveTension?: number;          // How curved the lines are (0.3 = gentle, 0.5 = more pronounced)
  minCurvePx?: number;            // Minimum pixel distance needed to draw a curve
  curveLengthPx?: number;         // How many pixels before a note ends to start the curve
  chromaticOpacity?: number;      // How visible the non-scale notes are (chromatic lines)
  diatonicOpacity?: number;       // How visible the scale notes are (diatonic lines)
  tonicOpacity?: number;          // How visible the root note lines are (tonic lines)
  mode: string;                   // Musical scale type (major, minor, etc.)
  tipMaxWidth?: number;           // Width of the playhead tip
  tipLength?: number;             // Length of the playhead tip tail
  contourThickness?: number;      // Thickness of the note contour lines
  lineAnimationsOn?: boolean;     // Whether lines pulse when notes are played
  gridMarginAdjust?: number;      // How much to adjust the grid margins to change visible width
  gridSpacing?: number;           // Controls the spacing between grid lines (1 = default spacing)
  lineWidth?: number;             // Base thickness of grid lines (1 = default, 2 = double, etc.)
  numGridLines?: number;          // Number of grid lines to display
}
/**
 * VisualizerCanvas is the main display component that shows musical notes as they play.
 * It creates a visual representation of music with horizontal lines for different notes
 * and a flowing contour that shows the melody as it plays.
 */
// Convert a time value (in seconds) to a horizontal position on the screen
// This calculates where on the screen a note should appear based on when it plays
function timeToX(t: number, currentTime: number, zoomSec: number, width: number, marginLeft: number = 0, marginRight: number = 0) {
  // Calculate the width of the visible grid area between the margins
  const gridWidth = width - marginLeft - marginRight;
  
  // Calculate the time range that's currently visible on screen
  // The left edge shows notes at (currentTime - zoomSec/2)
  // The right edge shows notes at (currentTime + zoomSec/2)
  const leftTime = currentTime - zoomSec / 2;
  const rightTime = currentTime + zoomSec / 2;
  
  // Calculate how far along this time range our target time is (0-1)
  const frac = (t - leftTime) / (rightTime - leftTime); // 0 = left edge, 1 = right edge
  
  // Convert this fraction to an actual screen position
  return marginLeft + (frac * gridWidth);
}

const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({
  notes,                      // The musical notes to display
  playTime,                   // Current playback position in seconds
  setPlayTime,                // Function to update the playback position
  setZoomSec,                 // Function to change how many seconds are visible
  labelsOn = true,            // Whether to show note labels (default: show them)
  rangeLow,                   // Lowest note to display (MIDI number)
  zoomSec,                    // How many seconds are visible on screen
  width = window.innerWidth,  // Width of the canvas (default: full window width)
  height = window.innerHeight,  // Height of the canvas (full viewport height)
  curveTension = 0.3,         // How curved the lines are (0.3 = gentle curves)
  minCurvePx = 4,             // Minimum pixel distance needed to draw a curve
  curveLengthPx = 16,         // How many pixels before a note ends to start the curve
  tonic,                      // The root note (like 'C' for C major)
  chromaticOpacity = 0.2,     // How visible the non-scale notes are (default: 20%)
  diatonicOpacity = 1.0,      // How visible the scale notes are (default: 100%)
  tonicOpacity = 1.0,         // How visible the root note lines are (default: 100%)
  mode,                       // Musical scale type (major, minor, etc.)
  tipMaxWidth = 13,           // Width of the playhead tip (13 pixels)
  tipLength = 18,             // Length of the playhead tip tail (18 pixels)
  contourThickness = 5,       // Thickness of the note contour lines (5 pixels)
  fontSize,                   // Size of the text labels
  lineAnimationsOn = true,    // Whether lines pulse when notes are played (default: yes)
  gridMarginAdjust = 0,       // How much to adjust margins (0 = default margins)
  gridSpacing = 1,            // Controls the spacing between grid lines (1 = default spacing)
  lineWidth = 1,              // Base thickness of grid lines (1 = default, 2 = double, etc.)
  numGridLines = 25           // Number of grid lines to display (default: 25)
}) => {

  // This keeps track of which note lines have been triggered at the playhead
  // and need to be animated with a temporary pulse effect
  const lineAnimations = useRef<Map<string, number>>(new Map());
  
  // This remembers the last playback position to detect when new notes start playing
  const lastPlayTime = useRef<number>(0);
  
  // How many horizontal note lines to display on screen
  const numLines = numGridLines; // Use the specified number of grid lines
  
  // For spacing calculations, we use the original design of 24 lines
  const originalNumLines = 24;
  
  // The space to leave at the edges of the screen
  const baseMarginLeft = labelsOn ? 54 : 20;  // Left margin is wider when labels are shown
  const baseMarginRight = 200;                 // Right margin gives space for future notes
  
  // Vertical spacing adjustments
  const marginTop = 24;     // Space at the top of the screen
  const marginBottom = 50;  // Space at the bottom of the screen
  
  // Minimum margin to prevent text from getting cut off at the edges
  const minMargin = 8;
  
  // Calculate how much we can adjust margins while keeping everything visible
  const maxPossibleAdjust = Math.min(
    baseMarginLeft - minMargin,
    baseMarginRight - minMargin
  );
  
  // Calculate the full width available for the grid with minimum margins
  const normalFullWidth = width - baseMarginLeft - baseMarginRight + (2 * maxPossibleAdjust);
  
  // Calculate how wide the grid should be based on the user's adjustment slider
  // The slider ranges from 50% width (default view) to 100% width (maximum view)
  const maxAdjustValue = 45; // This matches the maximum value in the App component
  const targetWidthPercent = 0.5 + (0.5 * gridMarginAdjust / maxAdjustValue);
  const targetWidth = normalFullWidth * targetWidthPercent;
  
  // The actual width available for the grid
  const availableWidth = targetWidth;
  
  // Calculate margins to center the grid in the window
  // This ensures the playhead (which shows the current playing position) stays centered
  const equalMargin = (width - availableWidth) / 2;
  
  // Make sure the left margin is never too small
  const marginLeft = Math.max(minMargin, equalMargin);
  
  // Adjust the right margin to maintain the correct grid width
  const marginRight = width - availableWidth - marginLeft;
  
  // Calculate the height of the grid to maintain even spacing between all note lines
  const originalGridHeight = height - marginTop - marginBottom;
  // Apply the gridSpacing factor to adjust the line spacing
  // Higher gridSpacing = more space between lines, lower = less space
  const baseLineSpacing = originalGridHeight / (originalNumLines - 1);
  const lineSpacing = baseLineSpacing * gridSpacing;
  const gridHeight = lineSpacing * (numLines - 1); // Height adjusted for all lines
  
  // The playhead (current position indicator) is always in the middle of the screen

  // Convert a MIDI note number to its position in our grid of horizontal lines
  // Lower notes are at the bottom (index 0), higher notes are at the top (index numLines-1)
  function pitchToLineIdx(pitch: number) {
    // Calculate how many semitones above the lowest note this pitch is
    const idx = pitchToLineIndex(pitch, rangeLow);
    // Make sure the index stays within our grid (between 0 and numLines-1)
    return Math.max(0, Math.min(numLines - 1, idx));
  }

  // Convert a line index to its vertical position (Y coordinate) on the screen
  // This centers the grid in the canvas and maps indices to vertical positions
  function lineIdxToY(idx: number) {
    // Calculate the center of the grid (middle line index)
    const middleLineIndex = (numLines - 1) / 2;
    
    // Calculate the vertical center of the canvas
    const canvasCenter = height / 2;
    
    // Calculate how far this line is from the middle line
    const distanceFromMiddle = middleLineIndex - idx;
    
    // Position the line relative to the canvas center
    return canvasCenter + (distanceFromMiddle * lineSpacing);
  }

  // Reference to the canvas element where we draw all the visualizations
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Reference to the container div that holds the canvas
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Track whether the user is currently dragging the visualization
  const isDragging = useRef(false);
  
  // Remember where the drag started (horizontal position)
  const dragStartX = useRef(0);
  
  // Remember what time position the drag started at
  const dragStartTime = useRef(0);

  // This effect detects when new notes start playing and creates pulse animations on their lines
  useEffect(() => {
    // Don't do anything if animations are turned off or if we're not moving forward in time
    if (!lineAnimationsOn || playTime <= lastPlayTime.current) {
      lastPlayTime.current = playTime;
      return;
    }
    
    // Find any notes that have started playing since the last update
    const newNoteOnsets = notes.filter(note => {
      return note.time > lastPlayTime.current && note.time <= playTime;
    });
    
    // For each new note that started playing, create a pulse animation on its line
    newNoteOnsets.forEach(note => {
      const lineIdx = pitchToLineIndex(note.pitch, rangeLow);
      if (lineIdx >= 0 && lineIdx < 24) {
        // Create a unique ID for this specific line (combining position and note name)
        // This ensures we only animate the exact line where the note is playing
        const degree = getChromaticDegreeLabel(rangeLow + lineIdx, noteNameToSemitone(tonic));
        const lineKey = `${lineIdx}:${degree}`;
        
        // Mark this line to start animating now
        lineAnimations.current.set(lineKey, performance.now());
      }
    });
    
    // Remember the current time for the next update
    lastPlayTime.current = playTime;
  }, [playTime, notes, rangeLow, tonic, lineAnimationsOn]);

  // This is the main drawing function that creates all the visualizations
  useEffect(() => {
    // Get the drawing context from the canvas
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return; // Exit if we can't draw
    
    // Get the device pixel ratio (higher for high-DPI displays like 4K)
    // We don't need to scale again here since we already did in the resize handler
    // but we need to know the DPR for calculating the actual canvas size in CSS pixels
    const devicePixelRatio = window.devicePixelRatio || 1;
    const cssWidth = canvasRef.current ? canvasRef.current.width / devicePixelRatio : width;
    const cssHeight = canvasRef.current ? canvasRef.current.height / devicePixelRatio : height;
    
    // Clear the entire canvas and fill with dark background
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = '#0d0d0d'; // Dark gray background color
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Calculate what time range is currently visible on screen
    const leftTime = playTime - zoomSec / 2;  // Time at left edge of screen
    const rightTime = playTime + zoomSec / 2; // Time at right edge of screen
    
    // The playhead (current position) is always in the center of the window
    const gridCenter = width / 2;
    
    // Convert the tonic note (like 'C' or 'F#') to a number (0-11) for calculations
    const tonicSem = noteNameToSemitone(tonic);
    // This defines the color for each note in the scale
    // Each note is labeled by its relationship to the tonic (root note)
    // For example, '1' is the tonic, '3' is the major third, '♭3' is the minor third
    const SCALE_DEGREE_COLOR_MAP: Record<string, string> = {
      '1': '#5858ff',   // Tonic (root note) - blue
      '♭2': '#acff59',  // Flat second - light green
      '2': '#ff59ff',   // Second - magenta
      '♭3': '#59ffac',  // Minor third - turquoise
      '3': '#ff5959',   // Major third - red
      '4': '#59acff',   // Fourth - light blue
      '#4': '#ffff59',  // Sharp fourth/tritone - yellow
      '5': '#ac59ff',   // Fifth - purple
      '♭6': '#59ff59',  // Minor sixth - green
      '6': '#ff59ac',   // Major sixth - pink
      '♭7': '#59ffff',  // Minor seventh - cyan
      '7': '#ffac59',   // Major seventh - orange
    };

    // Get the list of notes that aren't in the current scale (non-diatonic/chromatic notes)
    // These will be displayed differently than notes that are in the scale
    const nonDiatonicDegrees = getNonDiatonicDegrees(mode);
    
    // Create labels for each horizontal line showing what note it represents
    // Each label shows the relationship to the tonic (like '1', '3', '♭7', etc.)
    const degreeLabels = Array.from({ length: numLines }, (_, i) =>
      getChromaticDegreeLabel(rangeLow + i, tonicSem)
    );
    
    // STEP 1: Draw the horizontal grid lines and note labels
    ctx.save(); // Save the current drawing state
    ctx.font = `${fontSize}px sans-serif`; // Use the same font size as scrolling degrees
    ctx.textAlign = 'right'; // Align text to the right (labels go on left side)
    ctx.textBaseline = 'middle'; // Center text vertically on each line
    
    // Set default line thickness, adjusted for device pixel ratio and user preference
    // This ensures lines appear visually the same size regardless of screen resolution
    // We use Math.max(1, Math.round(lineWidth)) to ensure we always use whole pixel values
    const baseThickness = Math.max(1, Math.round(lineWidth));
    ctx.lineWidth = baseThickness / devicePixelRatio; // Default line thickness adjusted for screen resolution
    
    // Draw each horizontal line in the grid
    for (let i = 0; i < numLines; i++) {
      // Get the note name for this line
      const degree = degreeLabels[i];
      // Set the line color based on the note name
      ctx.strokeStyle = SCALE_DEGREE_COLOR_MAP[degree] || '#444';
      
      // Create a unique identifier for this specific line
      const lineKey = `${i}:${degree}`;
      const now = performance.now(); // Current time
      
      // Check if this line should be animated (if a note is playing on it)
      const animationStartTime = lineAnimations.current.get(lineKey);
      
      // Default line appearance
      // Adjust base thickness for device pixel ratio to maintain consistent visual size
      // Use the user-specified lineWidth, ensuring it's at least 1 and always a whole number
      const baseLineThickness = (baseThickness * 2) / devicePixelRatio; // Normal line thickness (2x base), adjusted for screen resolution
      let lineThickness = baseLineThickness; // Starting thickness
      let opacityBoost = 0; // No extra brightness by default
      
      // If this line has an active animation, calculate how it should look
      if (animationStartTime) {
        // How much time has passed since the animation started
        const elapsed = now - animationStartTime;
        const animDuration = 1000; // Animation lasts for 1 second
        
        // If the animation is still running
        if (elapsed < animDuration) {
          // Calculate how far through the animation we are (0-1)
          const progress = elapsed / animDuration;
          const maxThickness = 5; // Maximum thickness when a note starts
          
          // Create a smooth animation curve that starts fast and slows down
          // This makes the pulse effect look more natural
          const expProgress = 1 - Math.pow(1 - progress, 2);
          
          // Calculate the current line thickness - starts thick, gets thinner
          // The maxThickness also needs to be adjusted for device pixel ratio
          // Scale the animation max thickness proportionally to the base line width
          const adjustedMaxThickness = (baseThickness * 5) / devicePixelRatio; // Maximum thickness adjusted for screen resolution
          lineThickness = adjustedMaxThickness - (expProgress * (adjustedMaxThickness - baseLineThickness));
          
          // Also make the line a bit brighter at the start of the animation
          const maxOpacityBoost = 0.1; // Maximum 10% brightness boost
          opacityBoost = maxOpacityBoost * (1 - expProgress);
          
          // Schedule the next animation frame
          requestAnimationFrame(() => {
            if (canvasRef.current) {
              const redrawCtx = canvasRef.current.getContext('2d');
              if (redrawCtx) redrawCtx.clearRect(0, 0, 0, 0); // Trigger a redraw
            }
          });
        } else {
          // Animation has finished, remove it from the tracking list
          lineAnimations.current.delete(lineKey);
        }
      }
      
      // Set how visible each line should be based on what type of note it represents
      let baseOpacity;
      if (degree === "1") {
        // Root note (tonic) lines get their own opacity setting
        baseOpacity = tonicOpacity ?? 1.0;
      } else if (nonDiatonicDegrees.includes(degree)) {
        // Notes that aren't in the current scale (chromatic/non-diatonic) use chromaticOpacity
        baseOpacity = chromaticOpacity ?? 0.2;
      } else {
        // Notes that are in the scale (diatonic) use diatonicOpacity
        baseOpacity = diatonicOpacity ?? 1.0;
      }
      
      // Apply any extra brightness from animations, but never go above 100% opacity
      ctx.globalAlpha = Math.min(1.0, baseOpacity + opacityBoost);
      
      // Calculate the vertical position for this line using our centering function
      const y = lineIdxToY(i);
      
      // Draw the horizontal line with appropriate thickness
      if (degree === "1") {
        // Special treatment for the root note (tonic) line - make it thicker
        ctx.lineWidth = (baseThickness * 2) / devicePixelRatio; // Thicker line for the tonic, adjusted for screen resolution
      } else {
        // Use regular animation thickness for non-tonic lines
        ctx.lineWidth = lineThickness;
      }
      
      // Draw the line
      ctx.beginPath();
      ctx.moveTo(marginLeft, y + 0.5); // The +0.5 helps with pixel-perfect lines
      ctx.lineTo(width - marginRight, y + 0.5);
      ctx.stroke();
      
      // Reset line width for the next line
      ctx.lineWidth = 1;
      
      // Draw the note label on the left side of the grid
      if (labelsOn) {
        ctx.fillStyle = '#eee'; // Light gray text color
        ctx.fillText(degreeLabels[i], marginLeft - 40, y); // Position text 8px left of the grid
      }
    }
    ctx.restore(); // Restore the drawing state after drawing all grid lines
    
    // STEP 2: Create a clipping region so notes don't draw outside the horizontal grid area
    // This makes sure nothing draws in the left and right margins where the labels are
    // But we allow full vertical drawing for the playhead
    ctx.save();
    ctx.beginPath();
    ctx.rect(marginLeft, 0, width - marginLeft - marginRight, height);
    ctx.clip(); // Everything drawn after this will be confined to the horizontal grid area
    
    // Now we'll draw the flowing contour line that connects the notes
    // We use smooth curves to connect notes that are close together in time
    const restThreshold = 0.04; // If notes are more than 40ms apart, treat as separate phrases
    
    // For the contour to look good at the beginning, we need to add an invisible "helper" note
    // This note comes just before the first real note and helps the playhead tip draw correctly
    let processedNotes = [...notes]; // Start with all the real notes
    let hasSyntheticNote = false;   // Track if we added a helper note
    let syntheticNoteTime = -1;     // Remember when the helper note occurs
    
    // Only add the helper note if there are actual notes to visualize
    if (notes.length > 0) {
      // Find the first note by sorting all notes by time
      const sortedNotes = [...notes].sort((a, b) => a.time - b.time);
      const firstNote = sortedNotes[0];
      
      // Create a helper note that has the same pitch as the first real note
      // but occurs slightly earlier in time
      const syntheticPreNote: ParsedNote = {
        pitch: firstNote.pitch,                                     // Same note as the first real note
        time: Math.max(0, firstNote.time - (restThreshold * 3)),  // Just before the first note
        duration: restThreshold                                   // Very short duration
      };
      
      // Remember this helper note's time so we don't actually draw it later
      syntheticNoteTime = syntheticPreNote.time;
      hasSyntheticNote = true;
      
      // Add the helper note at the beginning of our notes array
      processedNotes = [syntheticPreNote, ...processedNotes];
    }
    
    // Find all the notes that should be part of the flowing contour line
    // This includes notes that are visible on screen or just about to appear
    const contourNotes = processedNotes
      // Only include notes that are at least partially visible in the current time window
      .filter(note => (note.time + note.duration) >= leftTime && note.time <= rightTime)
      .sort((a, b) => a.time - b.time); // Sort by time so we connect them in order
    
    // This array will track all the points along the contour line for drawing the playhead tip
    const contourPoints: { x: number; y: number }[] = [];
    
    // Only draw the contour if we have notes to connect
    if (contourNotes.length > 0) {
      const playheadX = gridCenter; // The playhead is always in the center of the screen
      
      // Process each note to draw the contour
      contourNotes.forEach((note, i) => {
        // Special handling for our invisible helper note
        if (hasSyntheticNote && Math.abs(note.time - syntheticNoteTime) < 0.001) {
          // For the helper note, we add its position to our tracking but don't actually draw it
          const noteStart = Math.max(note.time, leftTime);
          let xStart = timeToX(noteStart, playTime, zoomSec, width, marginLeft, marginRight);
          const yStart = lineIdxToY(pitchToLineIdx(note.pitch));
          
          // Only track this point if it's to the left of the playhead (already played)
          if (xStart <= playheadX) {
            // Add to the tracking points but don't draw anything
            contourPoints.push({ x: xStart, y: yStart });
          }
          return; // Skip drawing this helper note
        }
        
        // For normal notes, calculate where they start on screen
        const noteStart = Math.max(note.time, leftTime); // Don't start before the left edge of the screen
        let xStart = timeToX(noteStart, playTime, zoomSec, width, marginLeft, marginRight);
        const yStart = lineIdxToY(pitchToLineIdx(note.pitch));
        
        // If this note starts a new phrase (after a rest), start a new contour segment
        if (i === 0 || noteStart > (contourNotes[i - 1].time + contourNotes[i - 1].duration + restThreshold)) {
          if (xStart <= playheadX) {
            ctx.moveTo(xStart, yStart); // Start a new line segment
            contourPoints.push({ x: xStart, y: yStart }); // Track this point for the playhead tip
          }
        }
        
        // Calculate when this note ends
        const rawReleaseTime = note.time + note.duration;
        
        // Check if there's another note after this one
        const hasNext = i < contourNotes.length - 1;
        const nextOnset = hasNext ? contourNotes[i + 1].time : Infinity;
        
        // Determine if there's a real rest after this note (gap > threshold)
        const isRestAfter = hasNext && nextOnset - rawReleaseTime > restThreshold;
        
        // Figure out where to end this note - either at its end or at the start of the next note
        const releaseBase = Math.min(rawReleaseTime, nextOnset);
        
        // Calculate when to start the curve to the next note
        const timePerPx = zoomSec / width; // How many seconds each pixel represents
        const curveTimeLength = curveLengthPx * timePerPx; // Convert curve length from pixels to seconds
        const curveStartTime = Math.max(releaseBase - curveTimeLength, noteStart); // Don't start curve before note starts
        
        // Draw the horizontal line for this note up to where the curve starts (or playhead if sooner)
        let horizEndTime = playTime < curveStartTime ? playTime : curveStartTime;
        let xEnd = timeToX(horizEndTime, playTime, zoomSec, width, marginLeft, marginRight);
        
        // If this segment would cross the playhead, stop it at the playhead
        if (xEnd > gridCenter) {
          // Calculate the exact time at the playhead position
          const gridFraction = 0.5; // Playhead is at the center (50%)
          const playheadTime = leftTime + (gridFraction * (rightTime - leftTime));
          horizEndTime = Math.min(horizEndTime, playheadTime);
          xEnd = gridCenter; // Stop at the playhead
        }
        // Only draw this note if it starts before or at the playhead
        if (xStart <= gridCenter) {
          // Draw the horizontal line for this note using its scale degree color
          const idxD = pitchToLineIdx(note.pitch); // Get the line index for this note
          const degree = degreeLabels[idxD]; // Get the scale degree (like '1', '3', etc.)
          const color = SCALE_DEGREE_COLOR_MAP[degree] || '#444'; // Get the color for this note
          
          ctx.save(); // Save the current drawing state
          ctx.strokeStyle = color; // Set the line color
          ctx.lineWidth = contourThickness ?? 5; // Set the line thickness
          ctx.lineCap = 'round'; // Round the ends of the line for a smoother look
          
          // Draw the horizontal line from where the note starts to where it ends
          ctx.beginPath();
          ctx.moveTo(xStart, yStart);
          ctx.lineTo(xEnd, yStart);
          ctx.stroke();
          ctx.restore(); // Restore the previous drawing state
          
          // Track this endpoint for the playhead tip
          contourPoints.push({ x: xEnd, y: yStart });
        }
        // Now draw the curve connecting this note to the next note (if applicable)
        // Only draw the curve if: 1) There's no rest after this note, 2) There is a next note, and 3) We've reached the curve start time
        if (!isRestAfter && hasNext && playTime >= curveStartTime) {
          // Get information about the next note
          const nextNote = contourNotes[i + 1];
          const nextY = lineIdxToY(pitchToLineIdx(nextNote.pitch)); // Vertical position of next note
          let xNext = timeToX(nextOnset, playTime, zoomSec, width, marginLeft, marginRight); // Horizontal position of next note
          
          // Calculate where the curve should start and end
          let xCurveStart = timeToX(curveStartTime, playTime, zoomSec, width, marginLeft, marginRight);
          let xRelease = timeToX(releaseBase, playTime, zoomSec, width, marginLeft, marginRight);
          
          // If the curve would be very short, just use a straight line instead
          if (Math.abs(xRelease - xCurveStart) < minCurvePx) {
            // For short connections, use a straight line with a color gradient
            // This looks better than a tiny curve
            
            // Get the colors for the current and next notes
            const startDegree = degreeLabels[pitchToLineIdx(note.pitch)];
            const endDegree = degreeLabels[pitchToLineIdx(nextNote.pitch)];
            const startColor = SCALE_DEGREE_COLOR_MAP[startDegree] || '#444';
            const endColor = SCALE_DEGREE_COLOR_MAP[endDegree] || '#444';
            
            // Create a gradient that transitions from the current note's color to the next note's color
            const grad = ctx.createLinearGradient(xCurveStart, yStart, xNext, nextY);
            grad.addColorStop(0, startColor); // Start color
            grad.addColorStop(1, endColor);   // End color
            
            // Draw the straight line with the gradient
            ctx.save();
            ctx.strokeStyle = grad;
            ctx.lineWidth = contourThickness ?? 5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(xCurveStart, yStart);
            ctx.lineTo(xNext, nextY);
            ctx.stroke();
            ctx.restore();
            
            // Track the endpoint for the playhead tip
            contourPoints.push({ x: xNext, y: nextY });
            return; // Skip the rest of this note processing
          }
          // For longer curves, we use a smooth Bézier curve to connect the notes
          // A Bézier curve needs control points to determine its shape
          
          // First control point: extends horizontally from the start of the curve
          // This creates a smooth transition from the horizontal line to the curve
          const cp1x = xCurveStart + (xRelease - xCurveStart) * curveTension; // X position
          const cp1y = yStart; // Same Y as the current note (horizontal tangent)
          
          // Second control point: positioned to create a smooth approach to the next note
          const ramp = 0.75; // How quickly to move toward the next note's height (75%)
          const cp2x = xNext - (xNext - xRelease) * curveTension; // X position
          const cp2y = yStart + (nextY - yStart) * ramp; // Y position between current and next note
          
          // If the curve would cross the playhead, we need to only draw part of it
          // We need to find exactly where to stop the curve at the playhead
          let maxT = 1; // By default, draw the full curve (t=0 to t=1)
          
          if (xNext > gridCenter) {
            // The curve crosses the playhead, so find where to stop it
            // We use binary search to find the exact point where the curve crosses the playhead
            let tLow = 0, tHigh = 1;
            for (let iter = 0; iter < 20; iter++) { // 20 iterations for precision
              const tMid = (tLow + tHigh) / 2; // Try the midpoint
              // Calculate the X position at this point in the curve
              const xMid = cubicBezier(xCurveStart, cp1x, cp2x, xNext, tMid);
              // Adjust our search range based on whether this point is before or after the playhead
              if (xMid < gridCenter) tLow = tMid;
              else tHigh = tMid;
            }
            maxT = tLow; // This is where the curve crosses the playhead
          }
          // Now draw the curve - there are two cases:
          
          // Case 1: We're still in the process of drawing the curve (playTime < nextOnset)
          if (playTime < nextOnset) {
            // Calculate how far along the curve we should draw (0-1)
            const t = (playTime - curveStartTime) / (nextOnset - curveStartTime);
            
            // Get the colors for the gradient (from current note to next note)
            const startDegree = degreeLabels[pitchToLineIdx(note.pitch)];
            const endDegree = degreeLabels[pitchToLineIdx(nextNote.pitch)];
            const startColor = SCALE_DEGREE_COLOR_MAP[startDegree] || '#444';
            const endColor = SCALE_DEGREE_COLOR_MAP[endDegree] || '#444';
            
            // Create a gradient that transitions between the two note colors
            const grad = ctx.createLinearGradient(xCurveStart, yStart, xNext, nextY);
            grad.addColorStop(0, startColor); // Start with current note's color
            grad.addColorStop(1, endColor);   // End with next note's color
            
            // Draw the curve up to the current play position or playhead, whichever comes first
            ctx.save();
            ctx.strokeStyle = grad;
            ctx.lineWidth = contourThickness ?? 5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(xCurveStart, yStart);
            drawPartialBezier(ctx, xCurveStart, yStart, cp1x, cp1y, cp2x, cp2y, xNext, nextY, Math.min(t, maxT), contourPoints);
            ctx.stroke();
            ctx.restore();
          } 
          // Case 2: We've already reached the next note (playTime >= nextOnset)
          else {
            // Get the colors for the gradient (same as above)
            const startDegree = degreeLabels[pitchToLineIdx(note.pitch)];
            const endDegree = degreeLabels[pitchToLineIdx(nextNote.pitch)];
            const startColor = SCALE_DEGREE_COLOR_MAP[startDegree] || '#444';
            const endColor = SCALE_DEGREE_COLOR_MAP[endDegree] || '#444';
            
            // Create the color gradient
            const grad = ctx.createLinearGradient(xCurveStart, yStart, xNext, nextY);
            grad.addColorStop(0, startColor);
            grad.addColorStop(1, endColor);
            
            // Draw the full curve up to the playhead
            ctx.save();
            ctx.strokeStyle = grad;
            ctx.lineWidth = contourThickness ?? 5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(xCurveStart, yStart);
            drawPartialBezier(ctx, xCurveStart, yStart, cp1x, cp1y, cp2x, cp2y, xNext, nextY, maxT, contourPoints);
            ctx.stroke();
            ctx.restore();
          }
        }
      });
      // If the last note is still playing when we reach the playhead, extend its line to the playhead
      const last = contourNotes[contourNotes.length - 1]; // Get the last note in our sequence
      
      // Check if this last note is still active at the current play time
      if (last.time + last.duration >= playTime) {
        // Calculate the vertical position of this note
        const lastY = lineIdxToY(pitchToLineIdx(last.pitch));
        
        // Calculate where this note starts on screen (but not before the left edge)
        const lastX = timeToX(Math.max(last.time, leftTime), playTime, zoomSec, width, marginLeft, marginRight);
        
        // Only draw if the note starts before the playhead
        if (lastX <= gridCenter) {
          // Get the color for this note
          const idxL = pitchToLineIdx(last.pitch);
          const degree = degreeLabels[idxL];
          const color = SCALE_DEGREE_COLOR_MAP[degree] || '#444';
          
          // Draw a line from where the note starts to the playhead
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = contourThickness ?? 5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(lastX, lastY);
          ctx.lineTo(gridCenter, lastY);
          ctx.stroke();
          ctx.restore();
          
          // Track this endpoint for the playhead tip
          contourPoints.push({ x: gridCenter, y: lastY });
        }
      }
      
      // Now we'll draw the playhead tip that follows the contour
      // The tip is a teardrop shape that follows the direction of the melody
      // It only appears when a note is being played (when the playhead is inside a note)

      // --- Tip smoothing logic: show tip during smoothed contour segments (ignore sub-40ms rests) ---
      // Build smoothed intervals (continuous regions) based on restThreshold, just like the contour
      // processedNotes includes the synthetic pre-note so the tip appears correctly for the first note
      // but we've added logic to skip rendering the synthetic note in the contour
      const processedNotesInView = processedNotes
        .filter((note: ParsedNote) => (note.time + note.duration) >= leftTime && note.time <= rightTime)
        .sort((a: ParsedNote, b: ParsedNote) => a.time - b.time);
        
      const smoothedIntervals: { start: number, end: number }[] = [];
      if (processedNotesInView.length > 0) {
        let segStart = processedNotesInView[0].time;
        let segEnd = processedNotesInView[0].time + processedNotesInView[0].duration;
        for (let i = 1; i < processedNotesInView.length; i++) {
          const prev = processedNotesInView[i - 1];
          const curr = processedNotesInView[i];
          const prevEnd = prev.time + prev.duration;
          if (curr.time - prevEnd > restThreshold) {
            // Real rest: end previous segment
            smoothedIntervals.push({ start: segStart, end: segEnd });
            segStart = curr.time;
            segEnd = curr.time + curr.duration;
          } else {
            // Bridge short rest
            segEnd = Math.max(segEnd, curr.time + curr.duration);
          }
        }
        smoothedIntervals.push({ start: segStart, end: segEnd });
      }
      // Show the tip if playTime is within any smoothed interval
      const tipActive = smoothedIntervals.some(seg => playTime >= seg.start && playTime <= seg.end);
      if (tipActive && contourPoints.length > 1) {
        // Find the point on the contour closest to the playhead (x = gridCenter)
        // Use the grid center (between margins) instead of canvas center
        let minDist = Infinity;
        let idx = -1;
        for (let i = 0; i < contourPoints.length; i++) {
          const dist = Math.abs(contourPoints[i].x - gridCenter);
          if (dist < minDist) {
            minDist = dist;
            idx = i;
          }
        }
        // Only draw the tip if the contour actually reaches the playhead (within 1px)
        // This prevents the tip from "hanging" at the end of a note during a rest
        if (idx > 0 && minDist <= 1) {
          // Find the local direction (tangent) at the playhead
          const pt = contourPoints[idx];
          const prev = contourPoints[idx - 1];
          const dx = pt.x - prev.x;
          const dy = pt.y - prev.y;
          const len = Math.hypot(dx, dy) || 1;
          // Unit tangent vector
          const tx = dx / len;
          const ty = dy / len;
          // Tip starts TIP_SEGMENT_LENGTH back from the playhead, ends at playhead

          const x1 = pt.x;
          const y1 = pt.y;
          // --- Draw a horizontal tear-drop tip with a true rounded head (semicircle) and a tail that hugs the contour ---
          ctx.save();
          const maxWidth = tipMaxWidth; // from prop
          // Use tipLength directly from props below
          const tailWidth = 2; // width at tail
          // Find the tail point along the contour at distance tipLength from playhead
          let accDist = 0;
          let tailIdx = idx;
          let tailFrac = 0;
          for (let i = idx; i > 0; i--) {
            const p1 = contourPoints[i];
            const p0 = contourPoints[i - 1];
            const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
            if (accDist + segLen >= tipLength) {
              tailIdx = i;
              tailFrac = (tipLength - accDist) / segLen;
              break;
            }
            accDist += segLen;
          }
          // --- Sample intermediate points for a smoother, curve-hugging tip ---
          const numMidPts = 10; // number of intermediate points between head and tail (higher = smoother)
          const tipPointsRight: {x: number, y: number}[] = [];
          const tipPointsLeft: {x: number, y: number}[] = [];
          for (let j = 0; j <= numMidPts; j++) {
            const frac = j / (numMidPts + 1); // 0 (head) to 1 (tail)
            // Find the point this far along the tip
            let dist = frac * tipLength;

            let acc = 0;
            for (let i = idx; i > 0; i--) {
              const p1 = contourPoints[i];
              const p0 = contourPoints[i - 1];
              const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
              if (acc + segLen >= dist) {
                const segFrac = (dist - acc) / segLen;
                const px = p1.x + (p0.x - p1.x) * segFrac;
                const py = p1.y + (p0.y - p1.y) * segFrac;
                // Local tangent
                const tdx = p1.x - p0.x;
                const tdy = p1.y - p0.y;
                const tlen = Math.hypot(tdx, tdy) || 1;
                const txx = tdx / tlen;
                const tyy = tdy / tlen;
                // Perpendicular
                const perpXx = -tyy;
                const perpYy = txx;
                // Interpolate width
                const width = maxWidth - (maxWidth - tailWidth) * frac;
                tipPointsRight.push({
                  x: px - perpXx * (width / 2),
                  y: py - perpYy * (width / 2)
                });
                tipPointsLeft.unshift({
                  x: px + perpXx * (width / 2),
                  y: py + perpYy * (width / 2)
                });
                // found = true; // Variable was set but not used
                break;
              }
              acc += segLen;
            }
          }
          // Tail point
          let tailCenterX = x1, tailCenterY = y1, tailTx = tx, tailTy = ty;
          if (tailIdx > 0) {
            const p1 = contourPoints[tailIdx];
            const p0 = contourPoints[tailIdx - 1];
            tailCenterX = p1.x + (p0.x - p1.x) * tailFrac;
            tailCenterY = p1.y + (p0.y - p1.y) * tailFrac;
            // Tangent at tail
            const tdx = p1.x - p0.x;
            const tdy = p1.y - p0.y;
            const tlen = Math.hypot(tdx, tdy) || 1;
            tailTx = tdx / tlen;
            tailTy = tdy / tlen;
          }
          const tailPerpX = -tailTy;
          const tailPerpY = tailTx;
          const tailLeftX = tailCenterX + tailPerpX * (tailWidth / 2);
          const tailLeftY = tailCenterY + tailPerpY * (tailWidth / 2);
          const tailRightX = tailCenterX - tailPerpX * (tailWidth / 2);
          const tailRightY = tailCenterY - tailPerpY * (tailWidth / 2);
          // Perpendicular at head (playhead)
          const perpX = -ty;
          const perpY = tx;
          ctx.beginPath();
          // --- Draw semicircle at playhead for rounded head ---
          ctx.arc(x1, y1, maxWidth / 2, Math.atan2(perpY, perpX) + Math.PI, Math.atan2(perpY, perpX), false);
          // --- Draw right edge from head to tail, curving through intermediate points ---
          tipPointsRight.forEach(pt => ctx.lineTo(pt.x, pt.y));
          ctx.lineTo(tailRightX, tailRightY);
          // --- Draw left edge from tail back to head, through left-side midpoints ---
          ctx.lineTo(tailLeftX, tailLeftY);
          tipPointsLeft.forEach(pt => ctx.lineTo(pt.x, pt.y));
          ctx.closePath();
          // Determine which degree/color the playhead is currently creating
          // Find the note at the current playhead position
          const currentNote = contourNotes.find(note => {
            const noteStart = note.time;
            const noteEnd = note.time + note.duration;
            return playTime >= noteStart && playTime <= noteEnd;
          });
          
          // Get the degree color
          let degreeColor = '#FFFFFF';
          if (currentNote) {
            const idx = pitchToLineIdx(currentNote.pitch);
            const degree = degreeLabels[idx];
            const baseColor = SCALE_DEGREE_COLOR_MAP[degree] || '#444';
            
            // Create a color that's white with a tinge of the degree color (60/40 blend)
            const r = Math.floor(255 * 0.6 + parseInt(baseColor.slice(1, 3), 16) * 0.4);
            const g = Math.floor(255 * 0.6 + parseInt(baseColor.slice(3, 5), 16) * 0.4);
            const b = Math.floor(255 * 0.6 + parseInt(baseColor.slice(5, 7), 16) * 0.4);
            degreeColor = `rgb(${r}, ${g}, ${b})`;
          }
          
          // Gradient from playhead to tail with the tinted color
          const grad = ctx.createLinearGradient(x1, y1, tailCenterX, tailCenterY);
          grad.addColorStop(0, degreeColor);
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = grad;
          ctx.globalAlpha = 1.0;
          ctx.fill();
          ctx.restore();
          // --- End: contour-hugging semicircular teardrop tip ---

        }
      }
      // --- End of right-aligned tip modification ---
      ctx.restore();
    }

    /**
     * Draws a portion of a cubic Bézier curve from the starting point to a specified position
     * 
     * @param ctx - The canvas drawing context
     * @param x0, y0 - Starting point coordinates
     * @param x1, y1 - First control point coordinates
     * @param x2, y2 - Second control point coordinates
     * @param x3, y3 - End point coordinates
     * @param t1 - How much of the curve to draw (0-1, where 1 is the full curve)
     * @param points - Array to store points along the curve for later use
     */
    function drawPartialBezier(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, t1: number, points: { x: number; y: number }[]) {
      // Add the starting point to our tracking array
      points.push({ x: x0, y: y0 });
      
      // Calculate how many steps to use for a smooth curve (more steps = smoother curve)
      const steps = Math.max(2, Math.ceil(40 * t1));
      
      // Draw the curve as a series of small line segments
      for (let i = 1; i <= steps; ++i) {
        // Calculate how far along the curve we are (0-t1)
        const t = (i / steps) * t1;
        
        // Calculate the position at this point using the Bézier formula
        const x = cubicBezier(x0, x1, x2, x3, t);
        const y = cubicBezier(y0, y1, y2, y3, t);
        
        // Draw a line to this point
        ctx.lineTo(x, y);
        
        // Track this point for the playhead tip
        points.push({ x, y });
      }
    }
    
    /**
     * Calculates a point along a cubic Bézier curve at position t
     * 
     * @param a - Starting point
     * @param b - First control point
     * @param c - Second control point
     * @param d - End point
     * @param t - Position along the curve (0-1)
     * @returns The value at position t
     */
    function cubicBezier(a: number, b: number, c: number, d: number, t: number) {
      // This is the standard cubic Bézier formula
      return (
        (1 - t) ** 3 * a +              // Influence of starting point
        3 * (1 - t) ** 2 * t * b +       // Influence of first control point
        3 * (1 - t) * t ** 2 * c +       // Influence of second control point
        t ** 3 * d                       // Influence of end point
      );
    }

    // Draw labels for each note that's currently visible on screen
    // These labels show the scale degree (like '1', '3', '♭7') at each note's position
    
    // Find all notes that are currently visible in our time window
    const visibleNotes = notes.filter(note => note.time >= leftTime && note.time <= rightTime);
    
    // Set up text appearance
    ctx.font = `${fontSize}px sans-serif`; // Use the user-selected font size
    ctx.textAlign = 'center'; // Center the text horizontally at each note
    ctx.textBaseline = 'middle'; // Center the text vertically
    
    // Add some padding around the text for the background circle
    const circlePadding = 4; // 4 pixels of extra space around the text
    const baseCircleRadius = fontSize / 2 + circlePadding; // Base circle size based on font size
    
    // Draw each visible note's label
    for (const note of visibleNotes) {
      // Calculate where this note appears horizontally
      const x = timeToX(note.time, playTime, zoomSec, width, marginLeft, marginRight);
      
      // Skip notes that would be drawn outside the grid area
      if (x < marginLeft || x > (width - marginRight)) continue;
      
      // Calculate the vertical position for this note
      const idx = pitchToLineIdx(note.pitch);
      const y = lineIdxToY(idx);
      
      // Get the scale degree label for this note (like '1', '3', '♭7')
      const label = getChromaticDegreeLabel(note.pitch, tonicSem);
      
      // Adjust circle radius for labels with # or ♭ symbols
      // These symbols make the text wider, so we need a wider background circle
      let circleRadius = baseCircleRadius;
      if (label.includes('#') || label.includes('♭')) {
        // Make the circle wider for accidentals (# or ♭)
        circleRadius = baseCircleRadius * 1.4; // 40% wider for accidentals
      }
      
      // First draw a fading circular background behind the text
      // This helps the text stand out against the grid lines
      const grad = ctx.createRadialGradient(x, y, 0, x, y, circleRadius);
      grad.addColorStop(0, 'rgba(13,13,13,1)'); // Solid dark color in the center
      grad.addColorStop(1, 'rgba(13,13,13,0)'); // Completely transparent at the edges
      
      ctx.save();
      ctx.globalAlpha = 1.0; // Full opacity for the background
      ctx.beginPath();
      ctx.arc(x, y, circleRadius, 0, 2 * Math.PI); // Draw a full circle
      ctx.closePath();
      ctx.fillStyle = grad; // Use the gradient for the background
      ctx.fill();
      ctx.restore();
      
      // Now draw the text label on top of the background
      ctx.fillStyle = '#fff'; // White text
      ctx.globalAlpha = 0.9; // Slightly transparent
      // Create a special glowing effect when a note crosses the playhead
      // This makes it more visually obvious which note is currently playing
      
      // We need to keep track of when each note crosses the playhead
      // This is stored in a global object so it persists between redraws
      if (!(window as any).__scrollingDegreeGlowTimes) (window as any).__scrollingDegreeGlowTimes = {};
      const glowTimes = (window as any).__scrollingDegreeGlowTimes;
      
      // Calculate where the playhead is (always at the center of the grid)
      const gridWidth = width - marginLeft - marginRight;
      const gridCenter = marginLeft + gridWidth / 2;
      const playheadX = gridCenter;
      
      // Only trigger the glow when a note is very close to the playhead
      const glowThreshold = 1; // 1 pixel threshold
      
      // Create a unique key for this specific note
      const degreeKey = `${label}:${note.time}`;
      
      // If this note is crossing the playhead right now, start its glow effect
      if (Math.abs(x - playheadX) < glowThreshold) {
        glowTimes[degreeKey] = performance.now(); // Record the current time
      }
      
      // Calculate how strong the glow should be (fades out over time)
      let glowAlpha = 0; // Start with no glow
      const now = performance.now();
      const glowDuration = 500; // Glow lasts for 500 milliseconds
      
      // If this note has crossed the playhead recently
      if (glowTimes[degreeKey]) {
        const elapsed = now - glowTimes[degreeKey]; // How long since it crossed
        
        if (elapsed < glowDuration) {
          // Calculate glow strength - starts strong and fades out smoothly
          const progress = elapsed / glowDuration;
          glowAlpha = 1 - easeCubicOut(progress); // Smooth fade-out effect
          
          // Schedule another redraw to continue the animation
          if (!(window as any).__scrollingDegreeGlowAnimating) {
            (window as any).__scrollingDegreeGlowAnimating = true;
            requestAnimationFrame(() => { 
              (window as any).__scrollingDegreeGlowAnimating = false; 
              ctx.canvas.dispatchEvent(new Event('glowTick')); 
            });
          }
        } else {
          // Glow has completely faded out
          glowAlpha = 0;
        }
      }
      
      // If this note should be glowing, draw the glow effect
      if (glowAlpha > 0) {
        ctx.save();
        // Create a white glow around the text
        ctx.shadowColor = `rgba(255,255,255,${0.8 * glowAlpha})`; // White glow with fading opacity
        ctx.shadowBlur = 96 * glowAlpha; // Large blur radius that fades with the glow
        ctx.fillStyle = `rgba(255,255,255,${0.8 * glowAlpha})`; // White text with fading opacity
        ctx.font = `bold ${fontSize}px 'DM Sans', sans-serif`; // Bold text for the glow
        ctx.fillText(label, x, y); // Draw the glowing text
        ctx.restore();
      }
      // Draw the regular note label (always shown, with or without glow)
      ctx.save();
      
      // Color the text differently based on whether the note has been played yet
      // Notes that have already played (or are currently playing) are white
      // Notes that haven't played yet are gray
      const notePosition = note.time;
      const playheadTime = leftTime + (rightTime - leftTime) / 2; // Time at the playhead
      
      // Choose white for past/current notes, gray for future notes
      ctx.fillStyle = notePosition <= playheadTime ? '#fff' : '#777';
      ctx.globalAlpha = 0.9; // Slightly transparent
      ctx.font = `${fontSize}px 'DM Sans', sans-serif`; // Use the DM Sans font
      
      // Draw the note label
      ctx.fillText(label, x, y);
      ctx.restore();
    }
    
    // Reset opacity to full for subsequent drawing
    ctx.globalAlpha = 1.0;
    
    // Remove the clipping region so we can draw outside the grid area again
    ctx.restore();
    
    // Add soft fading edges on the left and right sides of the grid
    // This creates a smoother transition between the grid and the margins
    const fadeWidth = 150; // How wide each fade should be (in pixels)

    // Calculate where the right edge of the grid is
    const rightEdge = width - marginRight;
    
    // Create a fade on the left edge (from solid background color to transparent)
    const edgeFadeOffset = 8; // Extend the fade slightly outside the grid for a smoother look
    
    // Create a gradient that goes from solid color to transparent
    const leftGradient = ctx.createLinearGradient(marginLeft - edgeFadeOffset, 0, marginLeft + fadeWidth, 0);
    leftGradient.addColorStop(0, '#0d0d0d'); // Solid background color at the edge
    leftGradient.addColorStop(1, 'rgba(13, 13, 13, 0)'); // Transparent toward the center
    
    // Draw the left fade
    ctx.fillStyle = leftGradient;
    ctx.fillRect(marginLeft - edgeFadeOffset, 0, fadeWidth + edgeFadeOffset, height);
    
    // Create a fade on the right edge (from transparent to solid background color)
    const rightGradient = ctx.createLinearGradient(rightEdge - fadeWidth, 0, rightEdge + edgeFadeOffset, 0);
    rightGradient.addColorStop(0, 'rgba(13, 13, 13, 0)'); // Transparent toward the center
    rightGradient.addColorStop(1, '#0d0d0d'); // Solid background color at the edge
    
    // Draw the right fade
    ctx.fillStyle = rightGradient;
    ctx.fillRect(rightEdge - fadeWidth, 0, fadeWidth + edgeFadeOffset, height);
    
    // Draw the vertical playhead line in the center of the screen
    // The line extends 50px beyond the top and bottom of the grid
    ctx.save();
    ctx.strokeStyle = '#fff'; // White line
    // Adjust playhead line thickness for device pixel ratio and user preference
    // Playhead line is 1x the base thickness
    ctx.lineWidth = baseThickness / devicePixelRatio; // User-specified width, adjusted for screen resolution
    
    // Calculate the top and bottom positions of the grid
    // We use the lineIdxToY function to find the positions of the first and last grid lines
    const topGridLine = lineIdxToY(numLines - 1); // Top grid line (highest note)
    const bottomGridLine = lineIdxToY(0); // Bottom grid line (lowest note)
    
    // Extend the line 50px beyond the grid in both directions
    const playheadTop = topGridLine - 50;
    const playheadBottom = bottomGridLine + 50;
    
    // Draw the playhead line
    ctx.beginPath();
    ctx.moveTo(width / 2, playheadTop); // Start 50px above the top grid line
    ctx.lineTo(width / 2, playheadBottom); // End 50px below the bottom grid line
    ctx.stroke();
    ctx.restore();
  }, [notes, playTime, labelsOn, width, height, zoomSec, rangeLow, tonic, chromaticOpacity, diatonicOpacity, mode, contourThickness, curveTension, minCurvePx, curveLengthPx, tipMaxWidth, tipLength, gridSpacing, lineWidth]);

  // This function converts a mouse click position to a time position in the music
  // It's used when the user clicks to move the playhead to a specific time
  function seekTime(clientX: number, baseTime: number = playTime): number {
    // If we can't get the container's position, just return the current time
    if (!containerRef.current) return baseTime;
    
    // Get the position and size of our container element
    const rect = containerRef.current.getBoundingClientRect();
    
    // Calculate the mouse position relative to our container
    const relX = clientX - rect.left;

    // Calculate the width of the grid area (between margins)
    const gridWidth = width - marginLeft - marginRight;
    
    // Calculate how far from the center the click was, as a fraction of the grid width
    // 0 = center of grid, -0.5 = left edge of grid, +0.5 = right edge of grid
    const gridFrac = (relX - marginLeft - gridWidth/2) / gridWidth;
    
    // How many seconds are currently visible on screen
    const visibleSec = zoomSec;

    // Convert the fraction to a time offset from the current position
    // Make sure we don't go below 0 (beginning of the music)
    return Math.max(0, baseTime + gridFrac * visibleSec);
  }

  // Set up mouse and touch interactions for moving the playhead and zooming
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    // When the user presses down on the visualization
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault(); // Prevent default browser behavior
      isDragging.current = true; // Start tracking a drag operation
      dragStartX.current = e.clientX; // Remember where the drag started
      dragStartTime.current = playTime; // Remember what time position we started at
      
      // Note: We don't immediately jump the playhead on click
      // This creates a more natural "grab and drag" behavior
    };
    
    // When the user moves the pointer while dragging
    const onPointerMove = (e: PointerEvent) => {
      // Only respond if we're in the middle of a drag operation
      if (!isDragging.current) return;
      
      // Calculate how far the mouse has moved horizontally
      const deltaX = e.clientX - dragStartX.current;
      
      // Calculate the width of the grid area
      const gridWidth = width - marginLeft - marginRight;
      const visibleSec = zoomSec;
      
      // Convert the pixel movement to a time offset
      // Moving right = going backward in time, moving left = going forward in time
      const timeOffset = (deltaX / gridWidth) * visibleSec;
      
      // Calculate the new playback position
      const newTime = dragStartTime.current - timeOffset;
      
      // Update the playback position (but never go below 0)
      setPlayTime(Math.max(0, newTime));
    };

    // When the user releases the pointer after dragging
    const onPointerUp = () => { 
      isDragging.current = false; // End the drag operation
    };
    
    // Handle mouse wheel events for zooming and scrolling
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // Prevent default browser scrolling
      
      // Vertical scrolling controls zoom level
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        // Use a small zoom step for smoother zooming
        const zoomStep = 1.02; // 2% change per scroll tick
        
        // Scroll up = zoom in, scroll down = zoom out
        let newZoom = zoomSec * (e.deltaY > 0 ? zoomStep : 1 / zoomStep);
        
        // Keep zoom level within reasonable limits (1-120 seconds)
        newZoom = Math.max(1, Math.min(120, newZoom));
        setZoomSec(newZoom);
      } 
      // Horizontal scrolling moves through time
      else {
        const delta = e.deltaX;
        // Convert pixel movement to time movement
        const deltaTime = -delta / width * zoomSec;
        
        // Update the playback position
        let newTime = playTime + deltaTime;
        newTime = Math.max(0, newTime); // Never go below 0
        setPlayTime(newTime);
      }
    };
    
    // Handle clicking with modifier keys for precise seeking
    const onClick = (e: MouseEvent) => {
      // Only respond to clicks with Alt, Ctrl, or Command key held down
      if (e.altKey || e.ctrlKey || e.metaKey) {
        // Move the playhead directly to where the user clicked
        const newTime = seekTime(e.clientX);
        if (newTime >= 0) {
          setPlayTime(newTime);
        }
      }
    };
    
    // Set up all the event listeners for user interaction
    container.addEventListener('pointerdown', onPointerDown);  // Detect when user starts dragging
    container.addEventListener('pointermove', onPointerMove);  // Track mouse movement during drag
    container.addEventListener('pointerup', onPointerUp);      // Detect when user stops dragging
    container.addEventListener('wheel', onWheel, { passive: false });  // Handle scrolling for zoom/time
    container.addEventListener('click', onClick);              // Handle modifier+click for seeking
    
    // Clean up function that removes all event listeners when component unmounts
    // This prevents memory leaks and unexpected behavior
    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('click', onClick);
    };
  }, [playTime, width, zoomSec, setPlayTime]);

  // Handle window resizing to make the visualization responsive and resolution-aware
  useEffect(() => {
    // This function updates the canvas size when the window size changes
    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        // Get the device pixel ratio (higher for high-DPI displays like 4K)
        const dpr = window.devicePixelRatio || 1;
        
        // Get the CSS size of the container - use full viewport dimensions
        const displayWidth = window.innerWidth;
        const displayHeight = window.innerHeight;
        
        // Set the canvas size in CSS pixels (for layout)
        canvasRef.current.style.width = `${displayWidth}px`;
        canvasRef.current.style.height = `${displayHeight}px`;
        
        // Set the canvas internal dimensions scaled by device pixel ratio
        // This ensures we draw at the native resolution of the display for sharp text and lines
        canvasRef.current.width = Math.floor(displayWidth * dpr);
        canvasRef.current.height = Math.floor(displayHeight * dpr);
        
        // Scale all drawing operations by the device pixel ratio
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.scale(dpr, dpr);
          // Force a redraw
          ctx.clearRect(0, 0, 0, 0);
        }
      }
    };
    
    // Set the initial size when the component first loads
    handleResize();
    
    // Add a listener for window resize events
    window.addEventListener('resize', handleResize);
    
    // Clean up the listener when the component unmounts
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Render the visualization container and canvas
  return (
    <div ref={containerRef} style={{ 
      width: '100%',       // Take up full width of parent
      height: '100vh',     // Use the full viewport height
      margin: 0,           // No margins
      padding: 0,          // No padding
      border: 'none',      // No border
      borderRadius: 0,     // No rounded corners
      background: 'none',  // Transparent background
      boxShadow: 'none',   // No shadow
      overflow: 'visible'  // Allow content to overflow container
    }}>
      <canvas 
        ref={canvasRef}    // Reference to access the canvas element
        // Width and height are set dynamically by the resize handler
        style={{ 
          display: 'block',  // Display as a block element
          width: '100%',     // Take up full width of container
          height: '100%',    // Take up full height of container
          border: 'none',    // No border
          outline: 'none',   // No outline when focused
          boxShadow: 'none'  // No shadow
        }}
      />
    </div>
  );
};

export default VisualizerCanvas;
